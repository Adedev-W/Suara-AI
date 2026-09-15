import type { ConversationLogEntry, Hint, Session, SpeechPauseDetection, TalkMap } from '../domain/types.ts'
import { hintText, selectHint, words } from './flow.ts'

export type AssistantView = { status: 'hidden' | 'visible' | 'reading'; hint: Hint | null; personalizing: boolean }
export type AssistantContext = {
  session: Session | null; talkMap: TalkMap | null; activeIndex: number
  recentTranscript: string; finalTranscript: string; coveredConcepts: string[]; coveredKeywords: string[]
}
export type HintInput = {
  activeIndex: number; recentTranscript: string; finalTranscript: string
  coveredKeywords: string[]; previousHints: string[]; contextId: string
}
type Request = { key: string; id: string; controller: AbortController; startedAt: number }
type Episode = { blank: SpeechPauseDetection | null; key: string; shownAt: number; replaced: boolean; frozen: boolean }
type Dependencies = {
  now: () => number; wallNow: () => number
  request: (session: Session, input: HintInput, signal: AbortSignal) => Promise<Hint>
  render: (view: AssistantView) => void
  log: (entry: ConversationLogEntry) => void
  semanticNode: (nodeId: string, evidence: string) => void
}

export function contextKey(context: AssistantContext): string {
  return `${context.talkMap?.nodes[context.activeIndex]?.id ?? ''}:${words(context.recentTranscript).join(' ')}`
}

export function pauseThreshold(text: string, connected: boolean): number {
  if (!connected) return 2500
  // A forced STT endpoint can end mid-thought; finality alone is not sentence completion.
  const unfinished = /\b(and|or|but|because|so|the|a|an|of|to|with|is|are|was|were)[.!?]?\s*$/i.test(text)
  return !unfinished && /[.!?]["')\]]?\s*$/.test(text) ? 2500 : 1500
}

/** Owns request and display lifetimes independently; React only renders snapshots. */
export class AssistantController {
  private readonly deps: Dependencies
  private context: AssistantContext | null = null
  private running = false
  private generation = 0
  private revision = 0
  private key = ''
  private changedAt = 0
  private lastRequestedAt = -Infinity
  private attemptedKey = ''
  private request: Request | null = null
  private cached: { key: string; hint: Hint } | null = null
  private episode: Episode | null = null
  private history: string[] = []
  private view: AssistantView = { status: 'hidden', hint: null, personalizing: false }

  constructor(deps: Dependencies) { this.deps = deps }

  begin(): void {
    this.end()
    this.running = true
    this.generation += 1
    this.history = []
    this.key = ''
    this.attemptedKey = ''
    this.lastRequestedAt = -Infinity
  }

  end(): void {
    this.running = false
    this.request?.controller.abort()
    this.request = null
    this.cached = null
    this.episode = null
    this.publish({ status: 'hidden', hint: null, personalizing: false })
  }

  update(context: AssistantContext, callbacks?: Pick<Dependencies, 'log' | 'semanticNode'>): void {
    if (callbacks) {
      this.deps.log = callbacks.log
      this.deps.semanticNode = callbacks.semanticNode
    }
    this.context = context
    const key = contextKey(context)
    if (key === this.key) return
    this.key = key
    this.revision += 1
    this.changedAt = this.deps.now()
    this.cached = null
    // An in-flight request settles before the queued latest context is dispatched.
    // This avoids creating parallel provider work when browser cancellation cannot stop it.
  }

  tick(): void {
    if (!this.running || !this.context?.session || !this.context.talkMap) return
    const now = this.deps.now()
    if (this.request && now - this.request.startedAt >= 4000) {
      this.diagnostic(`Hint request timeout (${this.request.id}, 4000 ms)`)
      this.request.controller.abort()
      this.request = null
      this.publish({ ...this.view, personalizing: false })
    }
    if (this.view.personalizing && this.episode && now - this.episode.shownAt > 2000) {
      this.publish({ ...this.view, personalizing: false })
    }
    if (this.request || this.attemptedKey === this.key || !this.context.recentTranscript.trim()
      || now - this.changedAt < 300 || now - this.lastRequestedAt < 3000) return
    this.prepare()
  }

  speechStarted(): void {
    if (!this.running) return
    if (this.episode) this.episode.frozen = true
    this.publish({ ...this.view, status: this.view.hint ? 'reading' : 'hidden', personalizing: false })
  }

  stuck(blank: SpeechPauseDetection): void { this.show(blank) }
  manualHint(): void { this.show(null) }
  dismiss(): void {
    if (this.episode) this.episode.frozen = true
    this.publish({ ...this.view, status: 'hidden', personalizing: false })
  }

  private show(blank: SpeechPauseDetection | null): void {
    const context = this.context
    if (!this.running || !context?.talkMap) return
    if (blank) this.deps.log({ kind: 'blank', at: blank.startedAt, detectedAt: blank.detectedAt, durationMs: blank.durationMs })
    const hint = this.cached?.key === this.key && !this.history.includes(hintText(this.cached.hint)) ? this.cached.hint : selectHint(
      context.talkMap, context.activeIndex, new Set(context.coveredConcepts), this.history, context.recentTranscript,
    )
    this.episode = { blank, key: this.key, shownAt: this.deps.now(), replaced: hint?.source === 'ai', frozen: false }
    if (hint && hintText(hint) !== (this.view.hint ? hintText(this.view.hint) : '')) this.display(hint)
    else {
      if (this.view.hint) this.publish({ ...this.view, status: 'visible', personalizing: false })
      this.diagnostic('Existing hint retained: no new relevant candidate')
    }
    this.tick()
  }

  private prepare(): void {
    const context = this.context!
    const request: Request = { key: this.key, id: `${this.generation}:${++this.revision}`,
      controller: new AbortController(), startedAt: this.deps.now() }
    this.request = request
    this.lastRequestedAt = request.startedAt
    this.attemptedKey = request.key
    this.diagnostic(`Hint requested (${request.id})`)
    void this.deps.request(context.session!, {
      activeIndex: context.activeIndex, recentTranscript: context.recentTranscript,
      finalTranscript: context.finalTranscript.slice(-6000), coveredKeywords: context.coveredKeywords,
      previousHints: this.history.slice(-5), contextId: request.id,
    }, request.controller.signal).then((hint) => {
      if (!this.running || this.request !== request) return
      const elapsed = Math.round(this.deps.now() - request.startedAt)
      if (elapsed >= 4000) {
        this.diagnostic(`Hint discarded: response exceeded deadline (${request.id}, ${elapsed} ms)`)
        return
      }
      if (request.key !== this.key || hint.contextId !== request.id) {
        this.diagnostic(`Hint discarded: stale context (${request.id}, ${elapsed} ms)`)
        return
      }
      if (hint.source !== 'ai') {
        this.diagnostic(`AI unavailable: ${hint.generationStatus ?? 'provider_fallback'} (${elapsed} ms)`)
        return
      }
      this.cached = { key: request.key, hint }
      this.diagnostic(`AI candidate ready (${request.id}, ${elapsed} ms)`)
      const episode = this.episode
      if (episode && episode.key === request.key && !episode.frozen && !episode.replaced
        && this.deps.now() - episode.shownAt <= 2000) {
        episode.replaced = true
        this.display(hint)
      } else if (episode) this.diagnostic('AI replacement withheld: reading window closed or speech resumed')
      if (hint.nodeId && hint.evidence) this.deps.semanticNode(hint.nodeId, hint.evidence)
    }).catch((cause: unknown) => {
      if (this.request !== request || !this.running) return
      this.diagnostic(`Hint request failed: ${cause instanceof Error ? cause.name : 'network error'}`)
    }).finally(() => {
      if (this.request !== request) return
      this.request = null
      this.publish({ ...this.view, personalizing: false })
    })
  }

  private display(hint: Hint): void {
    const text = hintText(hint)
    if (this.history.some((previous) => words(previous).join(' ') === words(text).join(' '))) {
      this.diagnostic('Duplicate hint suppressed')
      return
    }
    this.history.push(text)
    this.publish({ status: 'visible', hint, personalizing: hint.source !== 'ai' })
    const blank = this.episode?.blank
    if (blank) {
      const at = this.deps.wallNow()
      this.deps.log({ kind: 'hint', at, hint, episodeStartedAt: blank.startedAt, trigger: 'automatic' })
      this.diagnostic(`Blank-to-display: ${Math.max(0, at - blank.detectedAt)} ms; source: ${hint.source}`)
    }
  }

  private publish(view: AssistantView): void { this.view = view; this.deps.render(view) }
  private diagnostic(detail: string): void { this.deps.log({ kind: 'diagnostic', at: this.deps.wallNow(), detail }) }
}

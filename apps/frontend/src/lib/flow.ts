import type { FlowState, Hint, StateEvent, TalkMap } from '../domain/types'

const wordPattern = /[a-z0-9']+/g
const fillers = new Set(['um', 'uh', 'er', 'so', 'basically', 'like'])

export type FlowObservation = {
  silenceMs: number
  fillerDensity: number
  repetitionScore: number
  semanticProgress: number
  activeNodeComplete: boolean
  meaningfulSpeechResumed?: boolean
  manualHintRequested?: boolean
  recentlyCompletedSection?: boolean
}

export type FlowDecision = { state: FlowState; changed: boolean; hint: Hint | null }

export class SpeakingFlowMachine {
  private current: FlowState = 'FLOWING'
  private cooldownUntil = 0
  private readonly hesitationSilenceMs: number
  private readonly stuckSilenceMs: number
  private readonly cooldownMs: number

  constructor(
    hesitationSilenceMs = 1800,
    stuckSilenceMs = 3000,
    cooldownMs = 6000,
  ) {
    this.hesitationSilenceMs = hesitationSilenceMs
    this.stuckSilenceMs = stuckSilenceMs
    this.cooldownMs = cooldownMs
  }

  get state(): FlowState { return this.current }

  observe(observation: FlowObservation, now = Date.now()): FlowDecision {
    const previous = this.current
    if (observation.meaningfulSpeechResumed) {
      if (this.current === 'HESITATING' || this.current === 'STUCK') {
        this.current = 'RECOVERED'
        this.cooldownUntil = now + this.cooldownMs
      } else if (this.current === 'RECOVERED') {
        this.current = 'FLOWING'
      }
    } else if (observation.manualHintRequested) {
      this.current = 'STUCK'
    } else if (observation.recentlyCompletedSection || now < this.cooldownUntil) {
      this.current = 'FLOWING'
    } else {
      const lowProgress = observation.semanticProgress < 0.35
      if (this.current === 'STUCK') {
        return { state: this.current, changed: false, hint: null }
      }
      if (
        this.current === 'HESITATING'
        && !(observation.silenceMs > this.stuckSilenceMs && !observation.activeNodeComplete && lowProgress)
      ) {
        return { state: this.current, changed: false, hint: null }
      }
      if (observation.silenceMs > this.stuckSilenceMs && !observation.activeNodeComplete && lowProgress) {
        this.current = 'STUCK'
      } else if (
        lowProgress &&
        (observation.silenceMs >= this.hesitationSilenceMs || observation.fillerDensity >= 0.2 || observation.repetitionScore >= 0.5)
      ) {
        this.current = 'HESITATING'
      } else {
        this.current = 'FLOWING'
      }
    }
    return { state: this.current, changed: this.current !== previous, hint: null }
  }
}

export function words(text: string): string[] {
  return text.toLowerCase().match(wordPattern) ?? []
}

export function fillerDensity(text: string): number {
  const tokens = words(text)
  if (!tokens.length) return 0
  return tokens.filter((token) => fillers.has(token)).length / tokens.length
}

export function repetitionScore(text: string): number {
  const tokens = words(text)
  if (tokens.length < 4) return 0
  const recent = tokens.slice(-12)
  const fragments = new Set<string>()
  let repeated = 0
  for (let size = 1; size <= 4; size += 1) {
    for (let index = 0; index + size <= recent.length; index += 1) {
      const fragment = recent.slice(index, index + size).join(' ')
      if (fragments.has(fragment)) repeated += size
      fragments.add(fragment)
    }
  }
  return Math.min(1, repeated / Math.max(1, recent.length * 2))
}

export function semanticProgress(node: TalkMap['nodes'][number] | undefined, text: string): number {
  return semanticProgressWithCoverage(node, text)
}

export function semanticProgressWithCoverage(
  node: TalkMap['nodes'][number] | undefined,
  text: string,
  coveredConcepts: ReadonlySet<string> = new Set(),
): number {
  if (!node) return 0
  const recent = new Set([...words(text), ...coveredConcepts])
  const concepts = [...new Set(node.keywords.flatMap(words))]
  return concepts.filter((concept) => recent.has(concept)).length / Math.max(1, concepts.length)
}

export function coveredConcepts(node: TalkMap['nodes'][number] | undefined, text: string): Set<string> {
  if (!node) return new Set()
  const spoken = new Set(words(text))
  return new Set(node.keywords.flatMap(words).filter((concept) => spoken.has(concept)))
}

export function nextUncoveredKeyword(
  node: TalkMap['nodes'][number] | undefined,
  covered: ReadonlySet<string> = new Set(),
): string | undefined {
  if (!node) return undefined
  return node.keywords.find((keyword) => words(keyword).some((concept) => !covered.has(concept)))
    ?? node.keywords.at(-1)
}

export function selectHint(
  talkMap: TalkMap,
  activeIndex: number,
  state: FlowState,
  covered: ReadonlySet<string> = new Set(),
): Hint | null {
  if (state === 'FLOWING' || state === 'RECOVERED' || !talkMap.nodes.length) return null
  const node = talkMap.nodes[Math.min(activeIndex, talkMap.nodes.length - 1)]
  const keyword = nextUncoveredKeyword(node, covered)
  if (state === 'HESITATING') return { level: 1, keyword, source: 'deterministic' }
  return { level: 2, keyword, starter: node.starter, nextIdea: node.next_prompt, source: 'deterministic' }
}

export function event(type: string, detail?: string, state?: FlowState, nodeId?: string): StateEvent {
  return { type, at: Date.now(), detail, state, nodeId }
}

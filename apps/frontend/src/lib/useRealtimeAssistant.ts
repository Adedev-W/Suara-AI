import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Hint, Session, StateEvent, TalkMap } from '../domain/types'
import { requestRealtimeHint } from './api'
import { event, selectHint } from './flow'

const HINT_REQUEST_TIMEOUT_MS = 4000

type RealtimeContext = {
  session: Session | null
  talkMap: TalkMap | null
  activeIndex: number
  recentTranscript: string
  coveredConcepts: string[]
  coveredKeywords: string[]
  onEvent: (nextEvent: StateEvent) => void
}

type RescueReason = 'automatic' | 'manual' | 'context-change'

type RescueEpisode = {
  nodeId: string
  controller: AbortController
}

export type AssistantView =
  | { status: 'hidden'; hint: Hint | null }
  | { status: 'visible'; hint: Hint; personalizing: boolean }

function hintText(hint: Hint): string {
  return `${hint.keyword} ${hint.starter} ${hint.nextIdea}`.trim()
}

export function useRealtimeAssistant(context: RealtimeContext) {
  const [view, setView] = useState<AssistantView>({ status: 'hidden', hint: null })
  const contextRef = useRef(context)
  const recordingRef = useRef(false)
  const episodeRef = useRef<RescueEpisode | null>(null)
  const previousHintsRef = useRef<string[]>([])

  useLayoutEffect(() => { contextRef.current = context }, [context])

  const cancelEpisode = useCallback(() => {
    episodeRef.current?.controller.abort()
    episodeRef.current = null
  }, [])

  const rememberHint = (hint: Hint) => {
    const text = hintText(hint)
    if (previousHintsRef.current.includes(text)) return
    previousHintsRef.current = [...previousHintsRef.current, text].slice(-5)
  }

  const startRescue = useCallback((reason: RescueReason) => {
    if (!recordingRef.current) return
    if (episodeRef.current && reason !== 'context-change') return

    const current = contextRef.current
    const node = current.talkMap?.nodes[current.activeIndex]
    if (!current.session || !current.talkMap || !node) return
    const fallback = selectHint(
      current.talkMap,
      current.activeIndex,
      new Set(current.coveredConcepts),
    )
    if (!fallback) return

    cancelEpisode()
    const episode: RescueEpisode = { nodeId: node.id, controller: new AbortController() }
    episodeRef.current = episode
    rememberHint(fallback)
    setView({ status: 'visible', hint: fallback, personalizing: true })
    current.onEvent(event('STUCK', reason, 'STUCK', node.id))
    current.onEvent(event('HINT_SHOWN', 'deterministic', 'STUCK', node.id))
    current.onEvent(event('HINT_REQUESTED', reason, 'STUCK', node.id))

    const timeout = window.setTimeout(() => episode.controller.abort(), HINT_REQUEST_TIMEOUT_MS)
    void requestRealtimeHint(current.session, {
      activeIndex: current.activeIndex,
      recentTranscript: current.recentTranscript,
      coveredKeywords: current.coveredKeywords,
      previousHints: previousHintsRef.current,
    }, episode.controller.signal).then((generated) => {
      const latest = contextRef.current
      const latestNode = latest.talkMap?.nodes[latest.activeIndex]
      if (
        episodeRef.current !== episode
        || latestNode?.id !== episode.nodeId
        || generated.source !== 'ai'
      ) return
      rememberHint(generated)
      setView({ status: 'visible', hint: generated, personalizing: false })
      latest.onEvent(event('HINT_SHOWN', 'ai', 'STUCK', episode.nodeId))
    }).catch((cause: unknown) => {
      if (episodeRef.current !== episode) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      contextRef.current.onEvent(event(
        'HINT_GENERATION_FAILED',
        'deterministic fallback retained',
        'STUCK',
        episode.nodeId,
      ))
    }).finally(() => {
      window.clearTimeout(timeout)
      if (episodeRef.current !== episode) return
      setView((currentView) => currentView.status === 'visible'
        ? { ...currentView, personalizing: false }
        : currentView)
    })
  }, [cancelEpisode])

  const noteSpeechStarted = useCallback(() => {
    if (!recordingRef.current || !episodeRef.current) return
    cancelEpisode()
    // Keeping the last cue mounted lets CSS fade it without another lifecycle timer.
    setView((current) => ({ status: 'hidden', hint: current.hint }))
    contextRef.current.onEvent(event('MEANINGFUL_SPEECH_RESUMED', undefined, 'FLOWING'))
  }, [cancelEpisode])

  const noteStuck = useCallback(() => startRescue('automatic'), [startRescue])

  const begin = useCallback(() => {
    recordingRef.current = true
    previousHintsRef.current = []
    cancelEpisode()
    setView({ status: 'hidden', hint: null })
  }, [cancelEpisode])

  const end = useCallback(() => {
    recordingRef.current = false
    cancelEpisode()
    setView({ status: 'hidden', hint: null })
  }, [cancelEpisode])

  const showManualHint = useCallback(() => startRescue('manual'), [startRescue])
  const activeNodeId = context.talkMap?.nodes[context.activeIndex]?.id
  useEffect(() => {
    if (episodeRef.current && episodeRef.current.nodeId !== activeNodeId) {
      startRescue('context-change')
    }
  }, [activeNodeId, startRescue])

  useEffect(() => () => {
    recordingRef.current = false
    episodeRef.current?.controller.abort()
  }, [])

  return {
    view,
    flowState: view.status === 'visible' ? 'STUCK' as const : 'FLOWING' as const,
    begin,
    end,
    noteSpeechStarted,
    noteStuck,
    showManualHint,
  }
}

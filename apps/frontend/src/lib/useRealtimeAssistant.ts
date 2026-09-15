import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationLogEntry, SpeechPauseDetection, StateEvent } from '../domain/types'
import { requestRealtimeHint } from './api'
import { AssistantController, pauseThreshold, type AssistantContext, type AssistantView } from './assistantController'

export type { AssistantView } from './assistantController'

type RealtimeContext = AssistantContext & {
  onEvent: (event: StateEvent) => void
  onConversationLog: (entry: ConversationLogEntry) => void
  onSemanticNode: (nodeId: string, evidence: string) => void
}

export function useRealtimeAssistant(context: RealtimeContext) {
  const [view, setView] = useState<AssistantView>({ status: 'hidden', hint: null, personalizing: false })
  const contextRef = useRef(context)
  const [controller] = useState(() => new AssistantController({
    now: () => performance.now(), wallNow: () => Date.now(), request: requestRealtimeHint,
    render: setView,
    log: () => {}, semanticNode: () => {},
  }))
  useLayoutEffect(() => {
    contextRef.current = context
    controller.update(context, {
      log: (entry) => {
        context.onConversationLog(entry)
        if (entry.kind === 'diagnostic') context.onEvent({ type: 'ASSISTANT_DIAGNOSTIC', at: entry.at, detail: entry.detail })
        if (entry.kind === 'blank') context.onEvent({ type: 'STUCK', at: entry.detectedAt })
        if (entry.kind === 'hint') context.onEvent({ type: 'HINT_SHOWN', at: entry.at, detail: entry.hint.source })
      },
      semanticNode: context.onSemanticNode,
    })
  }, [context, controller])
  useEffect(() => {
    const timer = window.setInterval(() => controller.tick(), 50)
    return () => { window.clearInterval(timer); controller.end() }
  }, [controller])
  return {
    view, flowState: view.status === 'visible' ? 'STUCK' as const : 'FLOWING' as const,
    begin: () => { controller.begin(); controller.update(contextRef.current) },
    end: () => controller.end(),
    noteSpeechStarted: () => controller.speechStarted(),
    noteStuck: (detection: SpeechPauseDetection) => controller.stuck(detection),
    showManualHint: () => controller.manualHint(),
    dismissHint: () => controller.dismiss(),
    pauseThreshold: (connected: boolean) => pauseThreshold(contextRef.current.recentTranscript, connected),
  }
}

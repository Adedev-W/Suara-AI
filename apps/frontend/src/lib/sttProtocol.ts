import type { SttTurn } from '../domain/types.ts'

export type SttMessage = SttTurn
  | { type: 'Begin'; model: string }
  | { type: 'SpeechStarted'; timestamp: number }
  | { type: 'Error'; detail: string }
  | { type: 'Termination' }

export function parseSttMessage(data: string): SttMessage | null {
  try {
    const message = JSON.parse(data) as Record<string, unknown>
    if (!message || typeof message !== 'object') return null
    if (message.type === 'Begin') {
      const configuration = message.configuration as { model?: string } | undefined
      return { type: 'Begin', model: configuration?.model ?? '' }
    }
    if (message.type === 'Error') return { type: 'Error', detail: typeof message.error === 'string' ? message.error : 'Speech service error' }
    if (message.type === 'Termination') return { type: 'Termination' }
    if (message.type === 'SpeechStarted' && typeof message.timestamp === 'number') return { type: 'SpeechStarted', timestamp: message.timestamp }
    if (message.type !== 'Turn' || !Number.isInteger(message.turn_order) || (message.turn_order as number) < 0
      || typeof message.transcript !== 'string') return null
    const words = Array.isArray(message.words) ? message.words as { start?: unknown; end?: unknown }[] : []
    const start = words[0]?.start
    const end = words.at(-1)?.end
    return { type: 'Turn', transcript: message.transcript, isFinal: message.end_of_turn === true,
      turnOrder: message.turn_order as number,
      startMs: typeof start === 'number' && Number.isFinite(start) && start >= 0 ? start : undefined,
      endMs: typeof end === 'number' && Number.isFinite(end) && end >= 0 ? end : undefined }
  } catch { return null }
}

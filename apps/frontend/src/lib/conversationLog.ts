import type { ConversationLogEntry, Hint } from '../domain/types'
import { hintText } from './flow.ts'

const timestampFormatter = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function formatConversationTime(timestamp: number): string {
  return timestampFormatter.format(new Date(timestamp))
}

export function sortConversationLog(
  entries: readonly ConversationLogEntry[],
): ConversationLogEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.at - right.entry.at || left.index - right.index)
    .map(({ entry }) => entry)
}

export function hintSourceLabel(hint: Hint): string {
  return hint.source === 'ai' ? 'AI suggestion' : 'Talk Map fallback'
}

export function formatConversationLog(entries: readonly ConversationLogEntry[]): string {
  const lines = ['SuaraAI conversation log', 'Times shown in your local timezone.', '']

  for (const entry of sortConversationLog(entries)) {
    if (entry.kind === 'diagnostic') {
      lines.push(`[${formatConversationTime(entry.at)}] Diagnostic: ${entry.detail}`)
      continue
    }
    if (entry.kind === 'utterance') {
      lines.push(`[${formatConversationTime(entry.at)}] You said: ${entry.text}`
        + (entry.receivedAt ? ` (transcript received ${formatConversationTime(entry.receivedAt)}`
          + (entry.endedAt ? `, ${Math.max(0, entry.receivedAt - entry.endedAt)} ms after speech ended` : '') + ')' : ''))
      continue
    }

    if (entry.kind === 'blank') {
      lines.push(
        `[${formatConversationTime(entry.detectedAt)}] Blank detected `
        + `(pause started ${formatConversationTime(entry.at)}, ${formatPauseDuration(entry.durationMs)})`,
      )
      continue
    }

    lines.push(
      `[${formatConversationTime(entry.at)}] Hint shown (${hintSourceLabel(entry.hint)}): `
      + hintText(entry.hint)
      + ` (blank started ${formatConversationTime(entry.episodeStartedAt)})`,
    )
  }

  return lines.join('\n')
}

export function formatPauseDuration(durationMs: number): string {
  const seconds = Math.max(0, durationMs) / 1000
  return `${seconds.toFixed(1)}s pause`
}

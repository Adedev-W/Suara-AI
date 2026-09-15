import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ConversationLogEntry } from '../domain/types'
import { hintText } from '../lib/flow'
import {
  formatConversationLog,
  formatConversationTime,
  formatPauseDuration,
  hintSourceLabel,
  sortConversationLog,
} from '../lib/conversationLog'

type ConversationLogModalProps = {
  entries: readonly ConversationLogEntry[]
  onClose: () => void
  returnFocusRef: RefObject<HTMLButtonElement | null>
}

export function ConversationLogModal({
  entries,
  onClose,
  returnFocusRef,
}: ConversationLogModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    closeButtonRef.current?.focus()
    const returnFocusTarget = returnFocusRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      returnFocusTarget?.focus()
    }
  }, [onClose, returnFocusRef])

  const copyLog = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(formatConversationLog(entries))
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }
  }

  const sortedEntries = sortConversationLog(entries)

  return (
    <div
      className="conversation-log-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="conversation-log-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conversation-log-title"
      >
        <header className="conversation-log-header">
          <div>
            <p className="eyebrow">After your take</p>
            <h2 id="conversation-log-title">Conversation log</h2>
            <p className="conversation-log-note">Times are shown in your local timezone.</p>
          </div>
          <button
            ref={closeButtonRef}
            className="conversation-log-close"
            type="button"
            onClick={onClose}
            aria-label="Close conversation log"
          >
            ×
          </button>
        </header>

        <div className="conversation-log-actions">
          <span>{entries.length} {entries.length === 1 ? 'event' : 'events'}</span>
          <button type="button" onClick={() => void copyLog()}>
            Copy log
          </button>
          {copyStatus === 'copied' && <span role="status">Copied</span>}
          {copyStatus === 'failed' && (
            <span className="conversation-log-copy-error" role="status">
              Copy failed — select the log manually.
            </span>
          )}
        </div>

        {sortedEntries.length === 0 ? (
          <p className="conversation-log-empty">No finalized speech or automatic hints were captured.</p>
        ) : (
          <ol className="conversation-log-list">
            {sortedEntries.map((entry, index) => (
              <ConversationLogItem key={`${entry.kind}-${entry.at}-${index}`} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function ConversationLogItem({ entry }: { entry: ConversationLogEntry }) {
  if (entry.kind === 'diagnostic') return <li className="conversation-log-item">
    <time>{formatConversationTime(entry.at)}</time>
    <details><summary>Diagnostic details</summary><p>{entry.detail}</p></details>
  </li>
  if (entry.kind === 'utterance') {
    return (
      <li className="conversation-log-item conversation-log-item-utterance">
        <time dateTime={new Date(entry.at).toISOString()}>{formatConversationTime(entry.at)}</time>
        <div>
          <strong>You said</strong>
          <p>{entry.text}</p>
          {entry.receivedAt && <small>Transcript received at {formatConversationTime(entry.receivedAt)}
            {entry.endedAt !== undefined && ` · ${Math.max(0, entry.receivedAt - entry.endedAt)} ms after speech ended`}</small>}
        </div>
      </li>
    )
  }

  if (entry.kind === 'blank') {
    return (
      <li className="conversation-log-item conversation-log-item-blank">
        <time dateTime={new Date(entry.at).toISOString()}>{formatConversationTime(entry.at)}</time>
        <div>
          <strong>Blank detected</strong>
          <p>
            Detected at {formatConversationTime(entry.detectedAt)} after {formatPauseDuration(entry.durationMs)}.
          </p>
        </div>
      </li>
    )
  }

  return (
    <li className="conversation-log-item conversation-log-item-hint">
      <time dateTime={new Date(entry.at).toISOString()}>{formatConversationTime(entry.at)}</time>
      <div>
        <strong>Hint shown · {hintSourceLabel(entry.hint)}</strong>
        <p className="conversation-log-hint-keyword">{entry.hint.keyword}</p>
        <p>{hintText(entry.hint)}</p>
        <p className="conversation-log-hint-context">
          For blank started at {formatConversationTime(entry.episodeStartedAt)}.
        </p>
      </div>
    </li>
  )
}

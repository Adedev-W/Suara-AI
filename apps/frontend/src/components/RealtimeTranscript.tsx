import { useEffect, useRef } from 'react'

const MAX_VISIBLE_TRANSCRIPT_CHARS = 1800
const MAX_VISIBLE_INTERIM_CHARS = 600

type RealtimeTranscriptProps = {
  finalTranscript: string
  interimTranscript: string
  statusLabel: string
}

export function RealtimeTranscript({
  finalTranscript,
  interimTranscript,
  statusLabel,
}: RealtimeTranscriptProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const visibleFinalTranscript = tail(finalTranscript, MAX_VISIBLE_TRANSCRIPT_CHARS)
  const visibleInterimTranscript = tail(interimTranscript, MAX_VISIBLE_INTERIM_CHARS)

  useEffect(() => {
    const viewport = viewportRef.current
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [visibleFinalTranscript, visibleInterimTranscript])

  return (
    <section className="recording-transcript" aria-label="Live transcript">
      <div className="recording-transcript-header">
        <span className="eyebrow">Live transcript</span>
        <span className="recording-transcript-state">{statusLabel}</span>
      </div>
      <div ref={viewportRef} className="recording-transcript-viewport">
        {visibleFinalTranscript ? (
          <span aria-live="polite">{visibleFinalTranscript}</span>
        ) : !visibleInterimTranscript ? (
          <span className="recording-transcript-empty">Your words will appear here.</span>
        ) : null}
        {visibleInterimTranscript && (
          <span className="recording-transcript-interim" aria-hidden="true">
            {visibleFinalTranscript ? ' ' : ''}{visibleInterimTranscript}
          </span>
        )}
      </div>
    </section>
  )
}

function tail(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const clipped = text.slice(-maxLength)
  const firstWordBoundary = clipped.indexOf(' ')
  return firstWordBoundary >= 0 ? `…${clipped.slice(firstWordBoundary)}` : `…${clipped}`
}

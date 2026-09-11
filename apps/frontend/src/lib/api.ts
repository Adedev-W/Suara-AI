import type { Feedback, Hint, InputKind, Session, StateEvent } from '../domain/types'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'
const REALTIME_HINT_TIMEOUT_MS = 4000

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? 'The request could not be completed.')
  }
  return response.json() as Promise<T>
}

export function prepareSession(inputKind: InputKind, inputText: string) {
  return request<Session>('/session/prepare', {
    method: 'POST',
    body: JSON.stringify({ input_kind: inputKind, input_text: inputText }),
  })
}

export function updateTalkMap(session: Session) {
  return request<Session>(`/session/${session.session_id}/talk-map`, {
    method: 'PATCH',
    headers: { 'X-Session-Token': session.access_token },
    body: JSON.stringify({ talk_map: session.talk_map }),
  })
}

export async function getSttToken() {
  return request<{
    token: string
    expires_in_seconds: number
    speech_model: string
  }>('/stt/token', { method: 'POST' })
}

export async function requestRealtimeHint(
  session: Session,
  input: {
    activeIndex: number
    recentTranscript: string
    coveredKeywords: string[]
    previousHints: string[]
  },
): Promise<Hint> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REALTIME_HINT_TIMEOUT_MS)
  try {
    const result = await request<{
      level: 2 | 3
      keyword: string | null
      starter: string | null
      next_idea: string | null
      source: 'ai' | 'deterministic'
    }>(`/session/${session.session_id}/hint`, {
      method: 'POST',
      headers: { 'X-Session-Token': session.access_token },
      body: JSON.stringify({
        active_index: input.activeIndex,
        recent_transcript: input.recentTranscript,
        covered_keywords: input.coveredKeywords,
        previous_hints: input.previousHints,
      }),
      signal: controller.signal,
    })
    return {
      level: result.level,
      keyword: result.keyword ?? undefined,
      starter: result.starter ?? undefined,
      nextIdea: result.next_idea ?? undefined,
      source: result.source,
    }
  } finally {
    window.clearTimeout(timeout)
  }
}

export function completeSession(session: Session, transcript: string, stateEvents: StateEvent[]) {
  return request<{ session_id: string; feedback: Feedback }>(`/session/${session.session_id}/complete`, {
    method: 'POST',
    headers: { 'X-Session-Token': session.access_token },
    body: JSON.stringify({ transcript, state_events: stateEvents }),
  })
}

export async function uploadKnowledge(session: Session, file: File) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${apiBaseUrl}/knowledge/documents?session_id=${session.session_id}`, {
    method: 'POST',
    headers: { 'X-Session-Token': session.access_token },
    body: form,
  })
  if (!response.ok) throw new Error('The document could not be processed.')
  return response.json() as Promise<{ source_name: string; chunk_count: number }>
}

export function askKnowledge(session: Session, question: string) {
  return request<{ answer: string; sources: { source_name: string; page_number: number | null; score: number }[] }>(
    `/knowledge/query?session_id=${session.session_id}`,
    {
      method: 'POST',
      headers: { 'X-Session-Token': session.access_token },
      body: JSON.stringify({ question }),
    },
  )
}

export { apiBaseUrl }

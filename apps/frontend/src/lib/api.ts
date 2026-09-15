import type { Feedback, Hint, InputKind, Session, StateEvent } from '../domain/types'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1'

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

export async function getSttToken(signal?: AbortSignal) {
  return request<{
    token: string
    expires_in_seconds: number
    speech_model: string
  }>('/stt/token', { method: 'POST', signal })
}

export async function requestRealtimeHint(
  session: Session,
  input: {
    activeIndex: number
    recentTranscript: string
    coveredKeywords: string[]
    previousHints: string[]
    finalTranscript: string
    contextId: string
  },
  signal?: AbortSignal,
): Promise<Hint> {
  const result = await request<{
    level: 2 | 3
    keyword: string
    starter: string
    next_idea: string
    source: 'ai' | 'deterministic'
    continuation: string
    node_id: string
    evidence: string
    generation_status: string
    context_id: string
  }>(`/session/${session.session_id}/hint`, {
    method: 'POST',
    headers: { 'X-Session-Token': session.access_token },
    body: JSON.stringify({
      active_index: input.activeIndex,
      recent_transcript: input.recentTranscript,
      covered_keywords: input.coveredKeywords,
      previous_hints: input.previousHints,
      final_transcript: input.finalTranscript,
      context_id: input.contextId,
    }),
    signal,
  })
  return {
    level: result.level,
    keyword: result.keyword,
    starter: result.starter,
    nextIdea: result.next_idea,
    source: result.source,
    continuation: result.continuation,
    nodeId: result.node_id,
    evidence: result.evidence,
    generationStatus: result.generation_status,
    contextId: result.context_id,
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

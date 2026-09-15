export type InputKind = 'topic' | 'notes' | 'key_points'
export type NodeStatus = 'upcoming' | 'active' | 'covered'
export type FlowState = 'FLOWING' | 'STUCK'

export type TalkMapNode = {
  id: string
  title: string
  intent: string
  keywords: string[]
  semantic_summary: string
  starter: string
  next_prompt: string
  status: NodeStatus
  rescue_candidates?: string[]
}

export type TalkMap = { title: string; nodes: TalkMapNode[] }

export type Session = {
  session_id: string
  access_token: string
  input_kind: InputKind
  talk_map: TalkMap
}

export type Feedback = {
  summary: string
  strengths: string[]
  improvements: string[]
  examples: string[]
  next_practice: string
}

export type StateEvent = {
  type: string
  at: number
  state?: FlowState
  nodeId?: string
  detail?: string
}

export type SttTurn = {
  type: 'Turn'
  transcript: string
  isFinal: boolean
  turnOrder: number
  startMs?: number
  endMs?: number
}

export type SpeechPauseDetection = {
  startedAt: number
  detectedAt: number
  durationMs: number
}

export type Hint = {
  level: 2 | 3
  keyword: string
  starter: string
  nextIdea: string
  source: 'ai' | 'deterministic'
  continuation?: string
  nodeId?: string
  evidence?: string
  generationStatus?: string
  contextId?: string
}

export type ConversationLogEntry =
  | { kind: 'utterance'; at: number; text: string; turnOrder?: number; endedAt?: number; receivedAt?: number }
  | { kind: 'diagnostic'; at: number; detail: string }
  | {
      kind: 'blank'
      at: number
      detectedAt: number
      durationMs: number
    }
  | {
      kind: 'hint'
      at: number
      hint: Hint
      episodeStartedAt: number
      trigger: 'automatic' | 'context-change'
    }

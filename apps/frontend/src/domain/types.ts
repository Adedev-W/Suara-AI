export type InputKind = 'topic' | 'notes' | 'key_points'
export type NodeStatus = 'upcoming' | 'active' | 'covered'
export type FlowState = 'FLOWING' | 'HESITATING' | 'STUCK' | 'RECOVERED'

export type TalkMapNode = {
  id: string
  title: string
  intent: string
  keywords: string[]
  semantic_summary: string
  starter: string
  next_prompt: string
  status: NodeStatus
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
  transcript?: string
  end_of_turn?: boolean
}

export type Hint = {
  level: 1 | 2 | 3
  keyword?: string
  starter?: string
  nextIdea?: string
  source?: 'ai' | 'deterministic'
}

import type { ConversationLogEntry, StateEvent, TalkMap } from '../domain/types.ts'
import { coveredConcepts, words } from './flow.ts'
import { updateNodeStatuses } from './talkMap.ts'

type TranscriptTurn = { text: string; isFinal: boolean; at: number; receivedAt: number; endedAt?: number }

export type RecordingProgress = {
  talkMap: TalkMap | null
  activeIndex: number
  coveredNodeIds: Set<string>
  coveredConceptsByNode: Map<string, Set<string>>
  turns: Map<number, TranscriptTurn>
  transcript: string
  recentTranscript: string
  interimTranscript: string
  events: StateEvent[]
  conversationLog: ConversationLogEntry[]
}

export type RecordingProgressAction =
  | { type: 'set-talk-map'; talkMap: TalkMap | null }
  | { type: 'begin'; talkMap: TalkMap; events: StateEvent[] }
  | { type: 'transcript-turn'; text: string; isFinal: boolean; at: number; turnOrder: number; receivedAt: number; endedAt?: number }
  | { type: 'semantic-node'; nodeId: string; evidence: string }
  | { type: 'add-event'; event: StateEvent }
  | { type: 'add-conversation-log'; entry: ConversationLogEntry }

export function createRecordingProgress(talkMap: TalkMap | null = null): RecordingProgress {
  return { talkMap, activeIndex: 0, coveredNodeIds: new Set(), coveredConceptsByNode: new Map(),
    turns: new Map(), transcript: '', recentTranscript: '', interimTranscript: '', events: [], conversationLog: [] }
}

export function recordingProgressReducer(state: RecordingProgress, action: RecordingProgressAction): RecordingProgress {
  if (action.type === 'set-talk-map') return createRecordingProgress(action.talkMap)
  if (action.type === 'begin') return { ...createRecordingProgress(updateNodeStatuses(action.talkMap, 0, new Set())), events: action.events }
  if (action.type === 'add-event') return { ...state, events: [...state.events, action.event] }
  if (action.type === 'add-conversation-log') return { ...state, conversationLog: [...state.conversationLog, action.entry] }
  if (action.type === 'semantic-node') {
    const index = state.talkMap?.nodes.findIndex((node) => node.id === action.nodeId) ?? -1
    if (!state.talkMap || index < 0 || index === state.activeIndex || !action.evidence.trim()
      || !state.transcript.toLowerCase().includes(action.evidence.toLowerCase())) return state
    // A quote supports the current topic, not completion of every skipped topic.
    return { ...state, activeIndex: index, talkMap: updateNodeStatuses(state.talkMap, index, state.coveredNodeIds) }
  }
  const previous = state.turns.get(action.turnOrder)
  if (previous?.isFinal && !action.isFinal) return state
  const turns = new Map(state.turns)
  turns.set(action.turnOrder, { text: action.text.trim(), isFinal: action.isFinal,
    at: action.at, receivedAt: action.receivedAt, endedAt: action.endedAt })
  const ordered = [...turns.entries()].sort(([a], [b]) => a - b)
  const transcript = ordered.filter(([, turn]) => turn.isFinal).map(([, turn]) => turn.text).filter(Boolean).join(' ')
  const interimTranscript = ordered.filter(([, turn]) => !turn.isFinal).map(([, turn]) => turn.text).filter(Boolean).join(' ')
  const conversationLog = state.conversationLog.filter((entry) => entry.kind !== 'utterance' || entry.turnOrder !== action.turnOrder)
  if (action.isFinal && action.text.trim()) conversationLog.push({ kind: 'utterance',
    at: action.at, endedAt: action.endedAt, receivedAt: action.receivedAt,
    turnOrder: action.turnOrder, text: action.text.trim() })
  const coverage = new Map<string, Set<string>>()
  for (const node of state.talkMap?.nodes ?? []) coverage.set(node.id, coveredConcepts(node, transcript))
  return { ...state, turns, transcript, interimTranscript,
    recentTranscript: ordered.map(([, turn]) => turn.text).filter(Boolean).join(' ').slice(-6000),
    coveredConceptsByNode: coverage, conversationLog }
}

export function coveredKeywordsForActiveNode(progress: RecordingProgress): string[] {
  const node = progress.talkMap?.nodes[progress.activeIndex]
  if (!node) return []
  const concepts = progress.coveredConceptsByNode.get(node.id) ?? new Set<string>()
  return node.keywords.filter((keyword) => words(keyword).every((word) => concepts.has(word)))
}

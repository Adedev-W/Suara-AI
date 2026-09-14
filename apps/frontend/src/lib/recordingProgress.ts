import type { StateEvent, TalkMap } from '../domain/types'
import { coveredConcepts, semanticProgressWithCoverage, words } from './flow'
import { findActiveNode, updateNodeStatuses } from './talkMap'

const MAX_FINAL_TRANSCRIPT_WINDOW_CHARS = 2400

export type RecordingProgress = {
  talkMap: TalkMap | null
  activeIndex: number
  coveredNodeIds: Set<string>
  coveredConceptsByNode: Map<string, Set<string>>
  nodeEvidence: Map<string, number>
  transcript: string
  recentTranscript: string
  events: StateEvent[]
}

export type RecordingProgressAction =
  | { type: 'set-talk-map'; talkMap: TalkMap | null }
  | { type: 'begin'; talkMap: TalkMap; events: StateEvent[] }
  | { type: 'final-turn'; text: string; at: number }
  | { type: 'add-event'; event: StateEvent }

export function createRecordingProgress(talkMap: TalkMap | null = null): RecordingProgress {
  return {
    talkMap,
    activeIndex: 0,
    coveredNodeIds: new Set(),
    coveredConceptsByNode: new Map(),
    nodeEvidence: new Map(),
    transcript: '',
    recentTranscript: '',
    events: [],
  }
}

export function recordingProgressReducer(
  state: RecordingProgress,
  action: RecordingProgressAction,
): RecordingProgress {
  if (action.type === 'set-talk-map') return createRecordingProgress(action.talkMap)
  if (action.type === 'begin') {
    const talkMap = updateNodeStatuses(action.talkMap, 0, new Set())
    return { ...createRecordingProgress(talkMap), events: action.events }
  }
  if (action.type === 'add-event') {
    return { ...state, events: [...state.events, action.event] }
  }

  const cleaned = action.text.trim()
  if (!cleaned) return state
  const transcript = `${state.transcript} ${cleaned}`.trim()
  const recentTranscript = `${state.recentTranscript} ${cleaned}`
    .trim()
    .slice(-MAX_FINAL_TRANSCRIPT_WINDOW_CHARS)
  const talkMap = state.talkMap
  const node = talkMap?.nodes[state.activeIndex]
  if (!talkMap || !node) return { ...state, transcript, recentTranscript }

  const coveredNodeIds = new Set(state.coveredNodeIds)
  const nodeConcepts = new Set(state.coveredConceptsByNode.get(node.id) ?? [])
  for (const concept of coveredConcepts(node, cleaned)) nodeConcepts.add(concept)
  const coveredConceptsByNode = new Map(state.coveredConceptsByNode)
  coveredConceptsByNode.set(node.id, nodeConcepts)

  const nodeEvidence = new Map(state.nodeEvidence)
  let sectionCompleted = false
  if (semanticProgressWithCoverage(node, recentTranscript, nodeConcepts) >= 0.6) {
    const evidence = (nodeEvidence.get(node.id) ?? 0) + 1
    nodeEvidence.set(node.id, evidence)
    if (evidence >= 2) {
      sectionCompleted = !coveredNodeIds.has(node.id)
      coveredNodeIds.add(node.id)
    }
  }

  const coveredIndices = new Set(
    talkMap.nodes.flatMap((item, index) => coveredNodeIds.has(item.id) ? [index] : []),
  )
  const activeIndex = sectionCompleted && state.activeIndex < talkMap.nodes.length - 1
    ? state.activeIndex + 1
    : findActiveNode(talkMap, recentTranscript, state.activeIndex, coveredIndices)
  const events = activeIndex === state.activeIndex
    ? state.events
    : [...state.events, {
      type: 'TALK_NODE_CHANGED',
      at: action.at,
      nodeId: talkMap.nodes[activeIndex]?.id,
    }]

  return {
    talkMap: updateNodeStatuses(talkMap, activeIndex, coveredNodeIds),
    activeIndex,
    coveredNodeIds,
    coveredConceptsByNode,
    nodeEvidence,
    transcript,
    recentTranscript,
    events,
  }
}

export function coveredKeywordsForActiveNode(progress: RecordingProgress): string[] {
  const node = progress.talkMap?.nodes[progress.activeIndex]
  if (!node) return []
  const concepts = progress.coveredConceptsByNode.get(node.id) ?? new Set<string>()
  return node.keywords.filter((keyword) => words(keyword).every((word) => concepts.has(word)))
}

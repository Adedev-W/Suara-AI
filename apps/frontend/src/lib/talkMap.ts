import type { TalkMap } from '../domain/types'
import { words } from './flow'

export function findActiveNode(talkMap: TalkMap, transcript: string, currentIndex: number): number {
  const recent = new Set(words(transcript))
  const score = (index: number) => {
    const node = talkMap.nodes[index]
    if (!node) return -1
    const hits = node.keywords.flatMap(words).filter((word) => recent.has(word)).length
    const bias = index === currentIndex ? 0.75 : index === currentIndex + 1 ? 0.35 : 0
    return hits + bias
  }
  const currentScore = score(currentIndex)
  const nextScore = score(currentIndex + 1)
  return nextScore > currentScore + 1 ? currentIndex + 1 : currentIndex
}

export function updateNodeStatuses(talkMap: TalkMap, activeIndex: number, covered: Set<string>): TalkMap {
  return {
    ...talkMap,
    nodes: talkMap.nodes.map((node, index) => ({
      ...node,
      status: covered.has(node.id) ? 'covered' : index === activeIndex ? 'active' : 'upcoming',
    })),
  }
}

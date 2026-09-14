import type { FlowState, Hint, StateEvent, TalkMap } from '../domain/types'

const wordPattern = /[a-z0-9']+/g

export function words(text: string): string[] {
  return text.toLowerCase().match(wordPattern) ?? []
}

export function semanticProgress(node: TalkMap['nodes'][number] | undefined, text: string): number {
  return semanticProgressWithCoverage(node, text)
}

export function semanticProgressWithCoverage(
  node: TalkMap['nodes'][number] | undefined,
  text: string,
  coveredConcepts: ReadonlySet<string> = new Set(),
): number {
  if (!node) return 0
  const recent = new Set([...words(text), ...coveredConcepts])
  const concepts = [...new Set(node.keywords.flatMap(words))]
  return concepts.filter((concept) => recent.has(concept)).length / Math.max(1, concepts.length)
}

export function coveredConcepts(node: TalkMap['nodes'][number] | undefined, text: string): Set<string> {
  if (!node) return new Set()
  const spoken = new Set(words(text))
  return new Set(node.keywords.flatMap(words).filter((concept) => spoken.has(concept)))
}

export function nextUncoveredKeyword(
  node: TalkMap['nodes'][number] | undefined,
  covered: ReadonlySet<string> = new Set(),
): string | undefined {
  if (!node) return undefined
  return node.keywords.find((keyword) => words(keyword).some((concept) => !covered.has(concept)))
    ?? node.keywords.at(-1)
}

export function selectHint(
  talkMap: TalkMap,
  activeIndex: number,
  covered: ReadonlySet<string> = new Set(),
): Hint | null {
  const node = talkMap.nodes[activeIndex]
  if (!node) return null
  const keyword = nextUncoveredKeyword(node, covered)
  if (!keyword) return null
  return { level: 2, keyword, starter: node.starter, nextIdea: node.next_prompt, source: 'deterministic' }
}

export function event(type: string, detail?: string, state?: FlowState, nodeId?: string): StateEvent {
  return { type, at: Date.now(), detail, state, nodeId }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { AssistantController, pauseThreshold } from '../src/lib/assistantController.ts'
import { SpeechPauseDetector } from '../src/lib/audio.ts'
import { createRecordingProgress, recordingProgressReducer } from '../src/lib/recordingProgress.ts'
import { parseSttMessage } from '../src/lib/sttProtocol.ts'
import { formatConversationLog } from '../src/lib/conversationLog.ts'
import { hintText, selectHint } from '../src/lib/flow.ts'

const continuation = 'It focuses on building systems that can perform tasks such as recognizing patterns, understanding language, and making predictions. For example, an email service can use AI to identify spam by learning patterns from previous messages. This helps people handle large amounts of information more efficiently.'
const node = { id: 'node-1', title: 'AI', intent: 'Explain AI', keywords: ['intelligence'], semantic_summary: 'AI and its uses', starter: 'What is AI?', next_prompt: 'Why does it matter?', status: 'active', rescue_candidates: [continuation, 'A second distinct candidate.', 'A third distinct candidate.'] }
const talkMap = { title: 'Artificial intelligence', nodes: [node] }
const context = { session: { session_id: 'one', access_token: 'test', input_kind: 'topic', talk_map: talkMap }, talkMap, activeIndex: 0,
  recentTranscript: 'Artificial intelligence is a branch of computer science', finalTranscript: '', coveredConcepts: [], coveredKeywords: [] }

function harness() {
  let now = 0
  const logs = [], views = [], calls = [], semantics = []
  const controller = new AssistantController({ now: () => now, wallNow: () => 100000 + now,
    render: (view) => views.push(view), log: (entry) => logs.push(entry), semanticNode: (...args) => semantics.push(args),
    request: (_session, input, signal) => new Promise((resolve, reject) => calls.push({ input, signal, resolve, reject })) })
  controller.begin()
  controller.update(context)
  return { controller, logs, views, calls, semantics,
    advance: (ms) => { now += ms; controller.tick() },
    blank: () => controller.stuck({ startedAt: 100000 + now - 1500, detectedAt: 100000 + now, durationMs: 1500 }) }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))
const aiHint = (call) => ({ level: 2, keyword: 'AI', starter: 'AI can help.', nextIdea: 'Consider email.', continuation,
  source: 'ai', contextId: call.input.contextId, nodeId: node.id, evidence: '' })

test('adaptive pause distinguishes unfinished speech and complete sentences', () => {
  assert.equal(pauseThreshold('AI is', true), 1500)
  assert.equal(pauseThreshold('This works because.', true), 1500)
  assert.equal(pauseThreshold('AI detects spam.', true), 2500)
  assert.equal(pauseThreshold('AI is', false), 2500)
})

test('partial context is prefetched before blank and cached AI appears immediately', async () => {
  const h = harness()
  h.advance(299)
  assert.equal(h.calls.length, 0)
  h.advance(1)
  assert.equal(h.calls[0].input.recentTranscript, context.recentTranscript)
  assert.equal(h.calls[0].input.finalTranscript, '')
  assert.deepEqual(h.calls[0].input.previousHints, [])
  h.calls[0].resolve(aiHint(h.calls[0]))
  await settle()
  assert.equal(h.logs.filter((entry) => entry.kind === 'hint').length, 0)
  h.advance(1200)
  h.blank()
  assert.equal(h.views.at(-1).hint.source, 'ai')
  assert.equal(h.logs.filter((entry) => entry.kind === 'hint').length, 1)
})

test('AI replaces fallback once within reading window, but never after speech resumes', async () => {
  const h = harness()
  h.advance(300)
  h.blank()
  const original = h.views.at(-1).hint
  h.controller.speechStarted()
  assert.equal(h.views.at(-1).status, 'reading')
  h.calls[0].resolve({ ...aiHint(h.calls[0]), continuation: continuation + ' Another idea.' })
  await settle()
  assert.equal(h.views.at(-1).hint, original)
  assert.ok(h.logs.some((entry) => entry.detail?.includes('speech resumed')))
  h.controller.dismiss()
  assert.equal(h.views.at(-1).status, 'hidden')
})

test('slow AI cannot replace a card the user has been reading for over two seconds', async () => {
  const h = harness()
  h.advance(300)
  h.blank()
  const original = h.views.at(-1).hint
  h.advance(2001)
  h.calls[0].resolve(aiHint(h.calls[0]))
  await settle()
  assert.equal(h.views.at(-1).hint, original)
})

test('a timely new AI continuation replaces fallback and logs both actual displays', async () => {
  const h = harness()
  h.advance(300)
  h.blank()
  h.advance(400)
  h.calls[0].resolve({ ...aiHint(h.calls[0]), continuation: 'For instance, ' + continuation })
  await settle()
  const displays = h.logs.filter((entry) => entry.kind === 'hint')
  assert.equal(displays.length, 2)
  assert.equal(displays[0].hint.source, 'deterministic')
  assert.equal(displays[1].hint.source, 'ai')
  assert.equal(displays[1].episodeStartedAt, displays[0].episodeStartedAt)
})

test('semantic progress needs final speech evidence, never a displayed hint', () => {
  const map = { ...talkMap, nodes: [node, { ...node, id: 'node-2' }] }
  let state = createRecordingProgress(map)
  state = recordingProgressReducer(state, { type: 'semantic-node', nodeId: 'node-2', evidence: 'AI detects spam' })
  assert.equal(state.activeIndex, 0)
  state = recordingProgressReducer(state, { type: 'transcript-turn', turnOrder: 0, text: 'AI detects spam.',
    isFinal: true, at: 1000, endedAt: 1800, receivedAt: 2000 })
  state = recordingProgressReducer(state, { type: 'semantic-node', nodeId: 'node-2', evidence: 'AI detects spam' })
  assert.equal(state.activeIndex, 1)
  assert.equal(state.coveredNodeIds.size, 0)
})

test('substantive context changes discard old responses and queue only latest input', async () => {
  const h = harness()
  h.advance(300)
  h.controller.update({ ...context, recentTranscript: 'AI helps doctors examine scans' })
  h.advance(300)
  assert.equal(h.calls.length, 1)
  h.calls[0].resolve(aiHint(h.calls[0]))
  await settle()
  assert.ok(h.logs.some((entry) => entry.detail?.includes('stale context')))
  h.advance(2700)
  assert.equal(h.calls.length, 2)
  assert.equal(h.calls[1].input.recentTranscript, 'AI helps doctors examine scans')
})

test('timeout aborts a request; old recording responses cannot enter a new take', async () => {
  const h = harness()
  h.advance(300)
  h.advance(4000)
  assert.equal(h.calls[0].signal.aborted, true)
  assert.ok(h.logs.some((entry) => entry.detail?.includes('timeout')))
  h.controller.begin()
  h.controller.update(context)
  h.calls[0].resolve(aiHint(h.calls[0]))
  await settle()
  assert.equal(h.views.at(-1).hint, null)
})

test('punctuation-only updates preserve a prepared context and failures are observable', async () => {
  const h = harness()
  h.advance(300)
  h.controller.update({ ...context, recentTranscript: context.recentTranscript + '.' })
  h.calls[0].resolve({ ...aiHint(h.calls[0]), source: 'deterministic', generationStatus: 'provider_fallback' })
  await settle()
  assert.ok(h.logs.some((entry) => entry.detail?.includes('provider_fallback')))
})

test('uses the short fallback after generated candidates are exhausted', () => {
  const first = selectHint(talkMap, 0, new Set(), [], '')
  assert.equal(first.continuation, continuation)
  const second = selectHint(talkMap, 0, new Set(), [continuation, 'A second distinct candidate.', 'A third distinct candidate.'], '')
  assert.equal(second.continuation, undefined)
  assert.equal(hintText(second), 'What is AI? Why does it matter?')
})

test('sample-based detector ignores short noise and requires new confirmed speech for each blank', () => {
  let clock = 0
  const blanks = []
  const detector = new SpeechPauseDetector(() => {}, (blank) => blanks.push(blank), () => 1500, 100000, () => 100000 + clock)
  detector.setConnected(true)
  const feed = (rms, duration) => { clock += duration; detector.observe(rms, duration) }
  feed(0.1, 100)
  feed(0, 2000)
  assert.equal(blanks.length, 0)
  for (let i = 0; i < 4; i++) feed(0.01, 50)
  detector.confirmSpeech(clock)
  for (let i = 0; i < 59; i++) feed(0, 25)
  assert.equal(blanks.length, 0)
  feed(0, 25)
  assert.equal(blanks.length, 1)
  assert.equal(blanks[0].durationMs, 1500)
  for (let i = 0; i < 4; i++) feed(0.1, 50)
  feed(0, 2000)
  assert.equal(blanks.length, 1)
  detector.confirmSpeech(clock)
  feed(0, 50)
  assert.equal(blanks.length, 2)
})

test('turn revisions replace partials and duplicate finals without duplicating log or speech', () => {
  let state = createRecordingProgress(talkMap)
  const turn = { type: 'transcript-turn', turnOrder: 0, text: 'AI is', isFinal: false, at: 1000, endedAt: 1800, receivedAt: 2500 }
  state = recordingProgressReducer(state, turn)
  assert.equal(state.recentTranscript, 'AI is')
  assert.equal(state.transcript, '')
  assert.equal(state.conversationLog.length, 0)
  state = recordingProgressReducer(state, { ...turn, text: 'AI detects spam.', isFinal: true })
  state = recordingProgressReducer(state, { ...turn, text: 'AI detects spam.', isFinal: true })
  state = recordingProgressReducer(state, { ...turn, text: 'stale interim' })
  assert.equal(state.transcript, 'AI detects spam.')
  assert.equal(state.interimTranscript, '')
  assert.equal(state.conversationLog.length, 1)
  assert.equal(state.conversationLog[0].at, 1000)
  assert.match(formatConversationLog(state.conversationLog), /700 ms after speech ended/)
})

test('STT parses word offsets and provider lifecycle messages; rejects malformed turns', () => {
  const turn = parseSttMessage(JSON.stringify({ type: 'Turn', turn_order: 2, transcript: 'AI detects spam', end_of_turn: true, words: [{ start: 100, end: 1000 }] }))
  assert.equal(turn.startMs, 100)
  assert.equal(turn.endMs, 1000)
  assert.equal(turn.turnOrder, 2)
  assert.equal(parseSttMessage('{'), null)
  assert.equal(parseSttMessage('{"type":"Turn","transcript":"bad"}'), null)
  assert.equal(parseSttMessage('{"type":"Termination"}').type, 'Termination')
})

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import './App.css'
import lightLogo from './assets/suaraai-logo-light.png'
import { ThemePicker } from './ThemePicker'
import type { Feedback, FlowState, Hint, InputKind, Session, StateEvent, TalkMap } from './domain/types'
import { completeSession, prepareSession, askKnowledge, requestRealtimeHint, updateTalkMap, uploadKnowledge } from './lib/api'
import { connectAudioToSocket, createVideoRecorder, stopMediaStream, type AudioPipeline } from './lib/audio'
import { coveredConcepts, event, fillerDensity, repetitionScore, selectHint, semanticProgressWithCoverage, SpeakingFlowMachine, words } from './lib/flow'
import { findActiveNode, updateNodeStatuses } from './lib/talkMap'
import { openAssemblySocket, parseSttMessage } from './lib/stt'

type AppMode = 'setup' | 'map' | 'ready' | 'recording' | 'preview' | 'feedback'
const SECTION_GRACE_MS = 2000
const MAX_FINAL_TRANSCRIPT_WINDOW_CHARS = 2400
const MANUAL_HINT_COOLDOWN_MS = 1500

function MicIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg> }
function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg> }

function App() {
  const [mode, setMode] = useState<AppMode>('setup')
  const [inputKind, setInputKind] = useState<InputKind>('topic')
  const [inputText, setInputText] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [talkMap, setTalkMap] = useState<TalkMap | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [covered, setCovered] = useState<Set<string>>(new Set())
  const [transcript, setTranscript] = useState('')
  const [partialTranscript, setPartialTranscript] = useState('')
  const [flowState, setFlowState] = useState<FlowState>('FLOWING')
  const [hint, setHint] = useState<Hint | null>(null)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [sttStatus, setSttStatus] = useState('Preparing live assistance')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [documentStatus, setDocumentStatus] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null)
  const [stateEvents, setStateEvents] = useState<StateEvent[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioRef = useRef<AudioPipeline | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const machineRef = useRef(new SpeakingFlowMachine())
  const lastSpeechAtRef = useRef(Date.now())
  const recentFinalTranscriptRef = useRef('')
  const talkMapRef = useRef<TalkMap | null>(null)
  const activeIndexRef = useRef(0)
  const coveredRef = useRef<Set<string>>(new Set())
  const coveredConceptsRef = useRef<Map<string, Set<string>>>(new Map())
  const nodeEvidenceRef = useRef<Map<string, number>>(new Map())
  const sectionGraceUntilRef = useRef(0)
  const hintRequestVersionRef = useRef(0)
  const hintEpisodeKeyRef = useRef<string | null>(null)
  const hintRequestInFlightRef = useRef(false)
  const lastHintRequestAtRef = useRef(0)
  const previousHintsRef = useRef<string[]>([])
  const flowStateRef = useRef<FlowState>('FLOWING')

  useEffect(() => { talkMapRef.current = talkMap }, [talkMap])
  useEffect(() => { activeIndexRef.current = activeIndex }, [activeIndex])
  useEffect(() => { coveredRef.current = covered }, [covered])
  useEffect(() => { flowStateRef.current = flowState }, [flowState])

  useEffect(() => {
    if (videoRef.current && mediaStream) videoRef.current.srcObject = mediaStream
  }, [mediaStream])

  useEffect(() => () => {
    audioRef.current?.close()
    socketRef.current?.close()
    stopMediaStream(mediaStream)
    if (videoUrl) URL.revokeObjectURL(videoUrl)
  }, [mediaStream, videoUrl])

  useEffect(() => {
    if (mode !== 'recording') return
    const timer = window.setInterval(() => {
      setRecordingSeconds((value) => value + 0.25)
      evaluateFlow()
    }, 250)
    return () => window.clearInterval(timer)
  }, [mode])

  const addEvent = (nextEvent: StateEvent) => setStateEvents((current) => [...current, nextEvent])

  const coveredConceptsForNode = (node: TalkMap['nodes'][number] | undefined) => (
    node ? (coveredConceptsRef.current.get(node.id) ?? new Set<string>()) : new Set<string>()
  )

  const coveredKeywordsForNode = (node: TalkMap['nodes'][number] | undefined) => {
    const concepts = coveredConceptsForNode(node)
    return node?.keywords.filter((keyword) => words(keyword).every((word) => concepts.has(word))) ?? []
  }

  const rememberHint = (nextHint: Hint | null) => {
    if (!nextHint) return
    const text = [nextHint.keyword, nextHint.starter, nextHint.nextIdea].filter(Boolean).join(' ')
    if (!text || previousHintsRef.current.includes(text)) return
    previousHintsRef.current = [...previousHintsRef.current, text].slice(-5)
  }

  const updateFinalTranscriptWindow = (finalTurn: string) => {
    recentFinalTranscriptRef.current = `${recentFinalTranscriptRef.current} ${finalTurn}`
      .trim()
      .slice(-MAX_FINAL_TRANSCRIPT_WINDOW_CHARS)
    return recentFinalTranscriptRef.current
  }

  const requestContextualHint = async (manual = false) => {
    const currentSession = session
    const currentTalkMap = talkMapRef.current
    const currentActiveIndex = activeIndexRef.current
    if (!currentSession || !currentTalkMap) return

    const currentNode = currentTalkMap.nodes[currentActiveIndex]
    const episodeKey = `${currentSession.session_id}:${currentNode?.id ?? currentActiveIndex}`
    const now = Date.now()
    if (hintRequestInFlightRef.current) return
    if (!manual && hintEpisodeKeyRef.current === episodeKey) return
    if (manual && now - lastHintRequestAtRef.current < MANUAL_HINT_COOLDOWN_MS) return

    hintEpisodeKeyRef.current = episodeKey
    hintRequestInFlightRef.current = true
    lastHintRequestAtRef.current = now
    const fallback = selectHint(
      currentTalkMap,
      currentActiveIndex,
      'STUCK',
      coveredConceptsForNode(currentNode),
    )
    rememberHint(fallback)
    setHint(fallback)
    if (fallback) {
      addEvent(event('HINT_SHOWN', 'deterministic', 'STUCK', currentNode?.id))
    }

    const requestVersion = ++hintRequestVersionRef.current
    addEvent(event('HINT_REQUESTED', manual ? 'manual' : 'automatic', 'STUCK', currentNode?.id))
    try {
      const generated = await requestRealtimeHint(currentSession, {
        activeIndex: currentActiveIndex,
        recentTranscript: recentFinalTranscriptRef.current,
        coveredKeywords: coveredKeywordsForNode(currentNode),
        previousHints: previousHintsRef.current,
      })
      if (
        requestVersion !== hintRequestVersionRef.current
        || activeIndexRef.current !== currentActiveIndex
        || flowStateRef.current !== 'STUCK'
      ) return
      rememberHint(generated)
      setHint(generated)
      addEvent(event('HINT_SHOWN', generated.source ?? 'ai', 'STUCK', currentNode?.id))
    } catch {
      addEvent(event('HINT_GENERATION_FAILED', 'deterministic fallback retained', 'STUCK', currentNode?.id))
    } finally {
      hintRequestInFlightRef.current = false
    }
  }

  const evaluateFlow = () => {
    const currentTalkMap = talkMapRef.current
    const currentActiveIndex = activeIndexRef.current
    const currentNode = currentTalkMap?.nodes[currentActiveIndex]
    const currentConcepts = coveredConceptsForNode(currentNode)
    const nextState = machineRef.current.observe({
      silenceMs: Date.now() - lastSpeechAtRef.current,
      fillerDensity: fillerDensity(recentFinalTranscriptRef.current),
      repetitionScore: repetitionScore(recentFinalTranscriptRef.current),
      semanticProgress: semanticProgressWithCoverage(
        currentNode,
        recentFinalTranscriptRef.current,
        currentConcepts,
      ),
      activeNodeComplete: Boolean(
        currentNode && coveredRef.current.has(currentNode.id),
      ),
      recentlyCompletedSection: Date.now() < sectionGraceUntilRef.current,
    })
    applyFlowDecision(nextState.state, nextState.changed)
  }

  const applyFlowDecision = (nextState: FlowState, changed: boolean, forceRescue = false) => {
    const currentTalkMap = talkMapRef.current
    const currentActiveIndex = activeIndexRef.current
    if (changed) addEvent(event(nextState, undefined, nextState, currentTalkMap?.nodes[currentActiveIndex]?.id))
    flowStateRef.current = nextState
    setFlowState(nextState)
    const currentNode = currentTalkMap?.nodes[currentActiveIndex]
    const deterministicHint = selectHint(
      currentTalkMap ?? { title: '', nodes: [] },
      currentActiveIndex,
      nextState,
      coveredConceptsForNode(currentNode),
    )
    if (nextState === 'STUCK' && (changed || forceRescue)) {
      void requestContextualHint(forceRescue)
    } else {
      rememberHint(deterministicHint)
      setHint(deterministicHint)
    }
  }

  const handleTurn = (turnText: string, final: boolean) => {
    const cleaned = turnText.trim()
    if (!cleaned) return
    setPartialTranscript(final ? '' : cleaned)
    lastSpeechAtRef.current = Date.now()
    if (!final) {
      if (flowStateRef.current === 'HESITATING' || flowStateRef.current === 'STUCK') {
        hintRequestVersionRef.current += 1
        setHint(null)
      }
      return
    }
    hintRequestVersionRef.current += 1
    setHint(null)
    const recentFinalTranscript = updateFinalTranscriptWindow(cleaned)
    const currentTalkMap = talkMapRef.current
    const currentActiveIndex = activeIndexRef.current
    const currentCovered = coveredRef.current
    const currentFlowState = flowStateRef.current
    setTranscript((current) => `${current} ${cleaned}`.trim())
    const node = currentTalkMap?.nodes[currentActiveIndex]
    const nextCovered = new Set(currentCovered)
    let sectionCompleted = false
    let currentProgress = 0
    if (node) {
      const nodeConcepts = new Set(coveredConceptsForNode(node))
      for (const concept of coveredConcepts(node, cleaned)) nodeConcepts.add(concept)
      coveredConceptsRef.current.set(node.id, nodeConcepts)
      currentProgress = semanticProgressWithCoverage(node, recentFinalTranscript, nodeConcepts)
      if (currentProgress >= 0.6) {
        const evidence = (nodeEvidenceRef.current.get(node.id) ?? 0) + 1
        nodeEvidenceRef.current.set(node.id, evidence)
        if (evidence >= 2) {
          nextCovered.add(node.id)
          sectionCompleted = !currentCovered.has(node.id)
          if (sectionCompleted) sectionGraceUntilRef.current = Date.now() + SECTION_GRACE_MS
        }
      }
    }
    const coveredIndices = new Set(
      currentTalkMap?.nodes.flatMap((item, index) => nextCovered.has(item.id) ? [index] : []) ?? [],
    )
    const nextIndex = currentTalkMap && sectionCompleted && currentActiveIndex < currentTalkMap.nodes.length - 1
      ? currentActiveIndex + 1
      : findActiveNode(
        currentTalkMap ?? { title: '', nodes: [] },
        recentFinalTranscript,
        currentActiveIndex,
        coveredIndices,
      )
    if (nextIndex !== currentActiveIndex && currentTalkMap) {
      setActiveIndex(nextIndex)
      activeIndexRef.current = nextIndex
      addEvent(event('TALK_NODE_CHANGED', undefined, currentFlowState, currentTalkMap.nodes[nextIndex]?.id))
    }
    coveredRef.current = nextCovered
    setCovered(nextCovered)
    if (currentTalkMap) {
      const updatedTalkMap = updateNodeStatuses(currentTalkMap, nextIndex, nextCovered)
      talkMapRef.current = updatedTalkMap
      setTalkMap(updatedTalkMap)
    }
    const nextState = machineRef.current.observe({
      silenceMs: 0,
      fillerDensity: fillerDensity(cleaned),
      repetitionScore: repetitionScore(cleaned),
      semanticProgress: currentProgress,
      activeNodeComplete: Boolean(node && nextCovered.has(node.id)),
      meaningfulSpeechResumed: true,
      recentlyCompletedSection: sectionCompleted,
    })
    if (currentFlowState === 'HESITATING' || currentFlowState === 'STUCK') {
      hintEpisodeKeyRef.current = null
      addEvent(event('MEANINGFUL_SPEECH_RESUMED', undefined, nextState.state))
    }
    applyFlowDecision(nextState.state, nextState.changed)
  }

  const createSpeakingSession = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const created = await prepareSession(inputKind, inputText)
      setSession(created)
      setTalkMap(created.talk_map)
      talkMapRef.current = created.talk_map
      setActiveIndex(0)
      activeIndexRef.current = 0
      coveredRef.current = new Set()
      setCovered(new Set())
      coveredConceptsRef.current = new Map()
      nodeEvidenceRef.current = new Map()
      recentFinalTranscriptRef.current = ''
      sectionGraceUntilRef.current = 0
      hintRequestVersionRef.current += 1
      hintEpisodeKeyRef.current = null
      hintRequestInFlightRef.current = false
      lastHintRequestAtRef.current = 0
      previousHintsRef.current = []
      setMode('map')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The session could not be prepared.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const requestCamera = async () => {
    setError('')
    stopMediaStream(mediaStream)
    setMediaStream(null)
    setCameraReady(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      setMediaStream(stream)
      setCameraReady(true)
      setMode('ready')
    } catch {
      setError('Camera and microphone access are required. Please allow access and try again.')
    }
  }

  const startRecording = async () => {
    if (!mediaStream || !talkMap) return
    const freshTalkMap = updateNodeStatuses(talkMap, 0, new Set())
    setError('')
    setTalkMap(freshTalkMap)
    talkMapRef.current = freshTalkMap
    setActiveIndex(0)
    activeIndexRef.current = 0
    setCovered(new Set())
    coveredRef.current = new Set()
    coveredConceptsRef.current = new Map()
    nodeEvidenceRef.current = new Map()
    recentFinalTranscriptRef.current = ''
    sectionGraceUntilRef.current = 0
    hintRequestVersionRef.current += 1
    hintEpisodeKeyRef.current = null
    hintRequestInFlightRef.current = false
    lastHintRequestAtRef.current = 0
    previousHintsRef.current = []
    setTranscript('')
    setPartialTranscript('')
    setRecordingSeconds(0)
    setStateEvents([event('MEDIA_READY')])
    setFlowState('FLOWING')
    flowStateRef.current = 'FLOWING'
    setHint(null)
    chunksRef.current = []
    machineRef.current = new SpeakingFlowMachine()
    lastSpeechAtRef.current = Date.now()
    recorderRef.current = createVideoRecorder(mediaStream, (chunk) => chunksRef.current.push(chunk))
    setMode('recording')
    addEvent(event('RECORDING_STARTED'))
    try {
      const socket = await openAssemblySocket()
      socketRef.current = socket
      setIsListening(true)
      setSttStatus('Live transcription connected')
      socket.onmessage = (message) => {
        const turn = parseSttMessage(String(message.data))
        if (turn?.transcript) handleTurn(turn.transcript, turn.end_of_turn === true)
      }
      socket.onclose = () => {
        setIsListening(false)
        setSttStatus('Recording continues; live assistance is unavailable')
        addEvent(event('STT_DISCONNECTED'))
      }
      audioRef.current = await connectAudioToSocket(mediaStream, socket)
    } catch {
      setIsListening(false)
      setSttStatus('Recording continues; live assistance is unavailable')
      addEvent(event('STT_DISCONNECTED', 'Speech transcription unavailable'))
    }
  }

  const finishRecording = async () => {
    hintRequestVersionRef.current += 1
    audioRef.current?.flush()
    audioRef.current?.close()
    audioRef.current = null
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, 750)
        socket.addEventListener('close', () => {
          window.clearTimeout(timeout)
          resolve()
        }, { once: true })
        socket.send(JSON.stringify({ type: 'Terminate' }))
      })
    }
    socket?.close()
    socketRef.current = null
    setIsListening(false)
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true })
        recorder.stop()
      })
    }
    recorderRef.current = null
    const nextUrl = URL.createObjectURL(new Blob(chunksRef.current, { type: 'video/webm' }))
    setVideoUrl((current) => { if (current) URL.revokeObjectURL(current); return nextUrl })
    addEvent(event('RECORDING_STOPPED'))
    stopMediaStream(mediaStream)
    setMediaStream(null)
    setCameraReady(false)
    setMode('preview')
  }

  const showManualHint = () => {
    const currentTalkMap = talkMapRef.current
    const currentActiveIndex = activeIndexRef.current
    if (!currentTalkMap) return
    const nextState = machineRef.current.observe({
      silenceMs: 0,
      fillerDensity: 0,
      repetitionScore: 0,
      semanticProgress: 0,
      activeNodeComplete: false,
      manualHintRequested: true,
    })
    addEvent(event('HINT_REQUESTED', undefined, 'STUCK', currentTalkMap.nodes[currentActiveIndex]?.id))
    applyFlowDecision(nextState.state, true, true)
  }

  const complete = async () => {
    if (!session || !transcript.trim()) {
      setError('Finish a spoken explanation before generating feedback.')
      return
    }
    setIsSubmitting(true)
    try {
      const result = await completeSession(session, transcript, stateEvents)
      setFeedback(result.feedback)
      setMode('feedback')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Feedback could not be generated.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const reset = () => {
    hintRequestVersionRef.current += 1
    hintEpisodeKeyRef.current = null
    hintRequestInFlightRef.current = false
    lastHintRequestAtRef.current = 0
    stopMediaStream(mediaStream)
    setMode('setup')
    setSession(null)
    setTalkMap(null)
    setTranscript('')
    setFeedback(null)
    setVideoUrl(null)
    setError('')
    setQuestion('')
    setAnswer('')
    setSources([])
    setCameraReady(false)
    setMediaStream(null)
    coveredConceptsRef.current = new Map()
    nodeEvidenceRef.current = new Map()
    recentFinalTranscriptRef.current = ''
    sectionGraceUntilRef.current = 0
    previousHintsRef.current = []
  }

  if (!session || !talkMap || mode === 'setup') {
    return <Shell><SetupScreen inputKind={inputKind} setInputKind={setInputKind} inputText={inputText} setInputText={setInputText} onSubmit={createSpeakingSession} isSubmitting={isSubmitting} error={error} /></Shell>
  }

  return <Shell>
    {mode === 'map' && <TalkMapScreen talkMap={talkMap} setTalkMap={setTalkMap} onContinue={async () => { try { const saved = await updateTalkMap({ ...session, talk_map: talkMap }); setSession(saved); setTalkMap(saved.talk_map); setMode('ready') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Talk Map could not be saved.') } }} error={error} />}
    {mode === 'ready' && <ReadyScreen videoRef={videoRef} cameraReady={cameraReady} onRequestCamera={requestCamera} onStart={startRecording} error={error} />}
    {mode === 'recording' && <RecordingScreen videoRef={videoRef} talkMap={talkMap} activeIndex={activeIndex} flowState={flowState} hint={hint} transcript={partialTranscript} recordingSeconds={recordingSeconds} sttStatus={sttStatus} isListening={isListening} onHint={showManualHint} onStop={finishRecording} />}
    {mode === 'preview' && <PreviewScreen videoUrl={videoUrl} transcript={transcript} onComplete={complete} onAgain={() => { setMode('ready'); void requestCamera() }} isSubmitting={isSubmitting} error={error} />}
    {mode === 'feedback' && feedback && <FeedbackScreen feedback={feedback} videoUrl={videoUrl} session={session} documentStatus={documentStatus} setDocumentStatus={setDocumentStatus} question={question} setQuestion={setQuestion} answer={answer} sources={sources} onAsk={async () => { try { const result = await askKnowledge(session, question); setAnswer(result.answer); setSources(result.sources.map((source) => `${source.source_name}${source.page_number ? ` · page ${source.page_number}` : ''}`)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'The question could not be answered.') } }} onUpload={async (file) => { try { const result = await uploadKnowledge(session, file); setDocumentStatus(`${result.source_name} indexed in ${result.chunk_count} chunks.`) } catch (cause) { setDocumentStatus(cause instanceof Error ? cause.message : 'The document could not be indexed.') } }} onReset={reset} error={error} />}
  </Shell>
}

function Shell({ children }: { children: ReactNode }) {
  return <main className="app-shell"><header className="topbar"><a className="brand" href="/" aria-label="SuaraAI home"><img src={lightLogo} alt="SuaraAI" /></a><span className="topbar-note">Speaking copilot</span><ThemePicker /></header>{children}<footer className="footer"><span>Keep your eyes on the lens.</span><span>SuaraAI / 2026</span></footer></main>
}

function SetupScreen(props: { inputKind: InputKind; setInputKind: (value: InputKind) => void; inputText: string; setInputText: (value: string) => void; onSubmit: (event: FormEvent) => void; isSubmitting: boolean; error: string }) {
  return <section className="page setup-page"><p className="eyebrow">A quieter way to practice</p><h1>Explain your idea<br />in your own words.</h1><p className="lede">SuaraAI keeps you oriented while you speak English on camera. It gives a small cue only when you need a way forward.</p><form className="setup-form" onSubmit={props.onSubmit}><div className="input-tabs">{(['topic', 'notes', 'key_points'] as InputKind[]).map((kind) => <button key={kind} type="button" className={props.inputKind === kind ? 'is-selected' : ''} onClick={() => props.setInputKind(kind)}>{kind === 'key_points' ? 'Key points' : kind[0].toUpperCase() + kind.slice(1)}</button>)}</div><textarea value={props.inputText} onChange={(event) => props.setInputText(event.target.value)} placeholder="What do you want to explain?" rows={5} required /><button className="primary-button" disabled={props.isSubmitting}>{props.isSubmitting ? 'Preparing your Talk Map…' : 'Create speaking session'} <ArrowIcon /></button>{props.error && <p className="error-message" role="alert">{props.error}</p>}</form></section>
}

function TalkMapScreen({ talkMap, setTalkMap, onContinue, error }: { talkMap: TalkMap; setTalkMap: (map: TalkMap) => void; onContinue: () => void; error: string }) {
  const moveNode = (index: number, direction: -1 | 1) => { const nodes = [...talkMap.nodes]; const target = index + direction; if (target < 0 || target >= nodes.length) return; [nodes[index], nodes[target]] = [nodes[target], nodes[index]]; setTalkMap({ ...talkMap, nodes }) }
  return <section className="page map-page"><p className="eyebrow">Before you record</p><h1>Your Talk Map.</h1><p className="lede">A few ideas to guide you, never a script to read.</p><div className="map-list">{talkMap.nodes.map((node, index) => <article className="map-node" key={node.id}><span className="node-number">0{index + 1}</span><div><strong>{node.title}</strong><p>{node.semantic_summary}</p><small>{node.keywords.join(' · ')}</small></div><div className="node-controls"><button type="button" onClick={() => moveNode(index, -1)} aria-label="Move node up">↑</button><button type="button" onClick={() => moveNode(index, 1)} aria-label="Move node down">↓</button></div></article>)}</div><button className="primary-button" type="button" onClick={onContinue}>Check camera and mic <ArrowIcon /></button>{error && <p className="error-message" role="alert">{error}</p>}</section>
}

function ReadyScreen({ videoRef, cameraReady, onRequestCamera, onStart, error }: { videoRef: RefObject<HTMLVideoElement | null>; cameraReady: boolean; onRequestCamera: () => void; onStart: () => void; error: string }) {
  return <section className="page ready-page"><p className="eyebrow">Camera readiness</p><h1>Settle in.<br />Then start.</h1><div className="camera-card"><video ref={videoRef} autoPlay muted playsInline />{!cameraReady && <div className="camera-placeholder"><MicIcon /><span>Your camera preview appears here.</span></div>}</div><div className="readiness-row"><span><i className={cameraReady ? 'ready-dot' : ''} />{cameraReady ? 'Camera + mic ready' : 'Permission required'}</span><button type="button" onClick={onRequestCamera}>{cameraReady ? 'Refresh preview' : 'Enable camera'}</button></div><button className="primary-button" type="button" disabled={!cameraReady} onClick={onStart}>Start recording <ArrowIcon /></button>{error && <p className="error-message" role="alert">{error}</p>}</section>
}

function RecordingScreen({ videoRef, talkMap, activeIndex, flowState, hint, transcript, recordingSeconds, sttStatus, isListening, onHint, onStop }: { videoRef: RefObject<HTMLVideoElement | null>; talkMap: TalkMap; activeIndex: number; flowState: FlowState; hint: ReturnType<typeof selectHint>; transcript: string; recordingSeconds: number; sttStatus: string; isListening: boolean; onHint: () => void; onStop: () => void }) {
  const node = talkMap.nodes[activeIndex]
  return <section className="recording-page"><div className="recording-video"><video ref={videoRef} autoPlay muted playsInline /><span className="recording-indicator"><i />REC {formatDuration(recordingSeconds)}</span><div className="recording-status">{isListening ? 'Live assistance on' : sttStatus}</div>{hint && <aside className="hint-card" aria-live="polite"><span className="hint-label">{hint.level === 1 ? 'A small nudge' : 'A way forward'}</span>{hint.level === 1 ? <strong>{hint.keyword}</strong> : <><strong>{hint.starter}</strong><p>{hint.nextIdea}</p></>}</aside>}<div className="recording-controls"><button type="button" onClick={onHint} aria-label="Show a hint"><span>?</span> Hint</button><button type="button" className="stop-button" onClick={onStop}>Stop recording</button></div></div><div className="recording-map"><p className="eyebrow">Current idea</p><h2>{node?.title}</h2><p>{node?.intent}</p><div className="mini-map">{talkMap.nodes.map((item) => <span key={item.id} className={item.status} />)}</div><p className="flow-label">{flowState === 'FLOWING' ? 'You are in your flow.' : flowState === 'RECOVERED' ? 'Good, keep going.' : 'A small cue is ready if you need it.'}</p>{transcript && <p className="live-transcript">{transcript}</p>}</div></section>
}

function PreviewScreen({ videoUrl, transcript, onComplete, onAgain, isSubmitting, error }: { videoUrl: string | null; transcript: string; onComplete: () => void; onAgain: () => void; isSubmitting: boolean; error: string }) {
  return <section className="page preview-page"><p className="eyebrow">Take complete</p><h1>That’s your take.</h1><p className="lede">Watch it back, then get one useful next step.</p>{videoUrl && <video className="preview-video" src={videoUrl} controls playsInline />}<p className="transcript-preview">{transcript || 'No final transcript was captured.'}</p><div className="button-row"><button type="button" onClick={onAgain}>Record again</button><button className="primary-button" type="button" disabled={isSubmitting || !transcript} onClick={onComplete}>{isSubmitting ? 'Reflecting…' : 'Get speaking feedback'} <ArrowIcon /></button></div>{error && <p className="error-message" role="alert">{error}</p>}</section>
}

function FeedbackScreen(props: { feedback: Feedback; videoUrl: string | null; session: Session; documentStatus: string; setDocumentStatus: (value: string) => void; question: string; setQuestion: (value: string) => void; answer: string; sources: string[]; onAsk: () => void; onUpload: (file: File) => void; onReset: () => void; error: string }) {
  return <section className="page feedback-page"><p className="eyebrow">Your practice note</p><h1>Keep this.<br />Try that next.</h1><p className="lede">{props.feedback.summary}</p><div className="feedback-grid"><FeedbackList title="What worked" items={props.feedback.strengths} /><FeedbackList title="Try next" items={props.feedback.improvements} /><FeedbackList title="Useful phrases" items={props.feedback.examples} /></div><div className="next-practice"><span className="eyebrow">Next practice</span><p>{props.feedback.next_practice}</p></div>{props.videoUrl && <a className="download-link" href={props.videoUrl} download="suaraai-recording.webm">Download your recording <ArrowIcon /></a>}<div className="knowledge-panel"><p className="eyebrow">Optional materials</p><h2>Ask about your notes.</h2><label className="upload-label">Add PDF or PPTX<input type="file" accept="application/pdf,.pdf,.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" onChange={(event) => { const file = event.target.files?.[0]; if (file) props.onUpload(file) }} /></label>{props.documentStatus && <p className="small-status">{props.documentStatus}</p>}<form onSubmit={(event) => { event.preventDefault(); props.onAsk() }}><input value={props.question} onChange={(event) => props.setQuestion(event.target.value)} placeholder="Ask a question about your materials" /><button type="submit">Ask <ArrowIcon /></button></form>{props.answer && <div className="answer"><p>{props.answer}</p>{props.sources.length > 0 && <small>Sources: {props.sources.join(', ')}</small>}</div>}</div><button className="text-action" type="button" onClick={props.onReset}>Start a new session <ArrowIcon /></button>{props.error && <p className="error-message" role="alert">{props.error}</p>}</section>
}

function FeedbackList({ title, items }: { title: string; items: string[] }) { return <div className="feedback-list"><h2>{title}</h2><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div> }
function formatDuration(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }

export default App

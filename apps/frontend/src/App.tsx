import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import './App.css'
import lightLogo from './assets/suaraai-logo-light.png'
import { ThemePicker } from './ThemePicker'
import type { Feedback, FlowState, InputKind, Session, StateEvent, TalkMap } from './domain/types'
import { completeSession, prepareSession, askKnowledge, updateTalkMap, uploadKnowledge } from './lib/api'
import { createAudioPipeline, createVideoRecorder, stopMediaStream, type AudioPipeline } from './lib/audio'
import { event } from './lib/flow'
import { coveredKeywordsForActiveNode, createRecordingProgress, recordingProgressReducer } from './lib/recordingProgress'
import { openAssemblySocket, parseSttMessage } from './lib/stt'
import { useRealtimeAssistant, type AssistantView } from './lib/useRealtimeAssistant'

type AppMode = 'setup' | 'map' | 'ready' | 'recording' | 'preview' | 'feedback'
function MicIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg> }
function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg> }

function App() {
  const [mode, setMode] = useState<AppMode>('setup')
  const [inputKind, setInputKind] = useState<InputKind>('topic')
  const [inputText, setInputText] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [progress, dispatchProgress] = useReducer(
    recordingProgressReducer,
    createRecordingProgress(),
  )
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
  const videoRef = useRef<HTMLVideoElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioRef = useRef<AudioPipeline | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const talkMap = progress.talkMap
  const activeIndex = progress.activeIndex
  const transcript = progress.transcript

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
    const timer = window.setInterval(() => setRecordingSeconds((value) => value + 0.25), 250)
    return () => window.clearInterval(timer)
  }, [mode])

  const addEvent = useCallback(
    (nextEvent: StateEvent) => dispatchProgress({ type: 'add-event', event: nextEvent }),
    [],
  )

  const activeNode = talkMap?.nodes[activeIndex]
  const activeCoveredConcepts = activeNode
    ? (progress.coveredConceptsByNode.get(activeNode.id) ?? new Set<string>())
    : new Set<string>()
  const realtimeAssistant = useRealtimeAssistant({
    session,
    talkMap,
    activeIndex,
    recentTranscript: progress.recentTranscript,
    coveredConcepts: [...activeCoveredConcepts],
    coveredKeywords: coveredKeywordsForActiveNode(progress),
    onEvent: addEvent,
  })

  const handleTurn = useCallback((turnText: string, final: boolean) => {
    if (!final || !turnText.trim()) return
    dispatchProgress({ type: 'final-turn', text: turnText, at: Date.now() })
  }, [])

  const createSpeakingSession = async (submitEvent: FormEvent) => {
    submitEvent.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      const created = await prepareSession(inputKind, inputText)
      setSession(created)
      dispatchProgress({ type: 'set-talk-map', talkMap: created.talk_map })
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
    setError('')
    setRecordingSeconds(0)
    setIsListening(false)
    setSttStatus('Preparing live assistance')
    audioRef.current?.close()
    socketRef.current?.close()
    audioRef.current = null
    socketRef.current = null
    chunksRef.current = []
    dispatchProgress({
      type: 'begin',
      talkMap,
      events: [event('MEDIA_READY'), event('RECORDING_STARTED')],
    })
    realtimeAssistant.begin()
    const recorder = createVideoRecorder(mediaStream, (chunk) => chunksRef.current.push(chunk))
    recorderRef.current = recorder
    setMode('recording')

    let liveSocket: WebSocket | null = null
    let sttFailureReported = false
    const pendingPcmChunks: ArrayBuffer[] = []
    const audioPromise = createAudioPipeline(mediaStream, {
      onPcmChunk: (chunk) => {
        if (liveSocket?.readyState === WebSocket.OPEN) {
          liveSocket.send(chunk)
          return
        }
        // Keep at most two seconds while STT connects so startup cannot grow memory unbounded.
        pendingPcmChunks.push(chunk)
        if (pendingPcmChunks.length > 20) pendingPcmChunks.shift()
      },
      onSpeechStarted: realtimeAssistant.noteSpeechStarted,
      onStuck: realtimeAssistant.noteStuck,
    }).then((audio) => {
      if (recorderRef.current !== recorder) {
        audio.close()
        return null
      }
      audioRef.current = audio
      return audio
    })
    const socketPromise = openAssemblySocket().then((socket) => {
      if (recorderRef.current !== recorder) {
        socket.close()
        return null
      }
      liveSocket = socket
      socketRef.current = socket
      socket.onmessage = (message) => {
        const turn = parseSttMessage(String(message.data))
        if (turn?.transcript) handleTurn(turn.transcript, turn.end_of_turn === true)
      }
      socket.onclose = () => {
        if (recorderRef.current !== recorder) return
        liveSocket = null
        sttFailureReported = true
        setIsListening(false)
        setSttStatus('Live transcript unavailable — guidance still works')
        addEvent(event('STT_DISCONNECTED'))
      }
      for (const chunk of pendingPcmChunks.splice(0)) socket.send(chunk)
      return socket
    })

    const [audioResult, socketResult] = await Promise.allSettled([audioPromise, socketPromise])
    if (recorderRef.current !== recorder) return
    const audioAvailable = audioResult.status === 'fulfilled' && audioResult.value !== null
    const socketAvailable = socketResult.status === 'fulfilled'
      && socketResult.value?.readyState === WebSocket.OPEN
    if (!audioAvailable) addEvent(event('AUDIO_ASSISTANCE_UNAVAILABLE'))
    if (!socketAvailable && !sttFailureReported) {
      addEvent(event('STT_DISCONNECTED', 'Speech transcription unavailable'))
    }
    if (!audioAvailable && socketAvailable) {
      if (socketResult.status === 'fulfilled' && socketResult.value) {
        socketResult.value.onclose = null
        liveSocket = null
        socketResult.value.close()
      }
      socketRef.current = null
    }
    const assistanceReady = audioAvailable && socketAvailable
    setIsListening(assistanceReady)
    if (assistanceReady) {
      setSttStatus('Listening')
    } else if (audioAvailable) {
      setSttStatus('Live transcript unavailable — guidance still works')
    } else {
      setIsListening(false)
      setSttStatus('Voice guidance unavailable — manual hints still work')
    }
  }

  const finishRecording = async () => {
    realtimeAssistant.end()
    audioRef.current?.flush()
    audioRef.current?.close()
    audioRef.current = null
    const socket = socketRef.current
    if (socket) socket.onclose = null
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

  const showManualHint = () => realtimeAssistant.showManualHint()

  const complete = async () => {
    if (!session || !transcript.trim()) {
      setError('Finish a spoken explanation before generating feedback.')
      return
    }
    setIsSubmitting(true)
    try {
      const result = await completeSession(session, transcript, progress.events)
      setFeedback(result.feedback)
      setMode('feedback')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Feedback could not be generated.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const reset = () => {
    realtimeAssistant.end()
    stopMediaStream(mediaStream)
    setMode('setup')
    setSession(null)
    dispatchProgress({ type: 'set-talk-map', talkMap: null })
    setFeedback(null)
    setVideoUrl(null)
    setError('')
    setQuestion('')
    setAnswer('')
    setSources([])
    setCameraReady(false)
    setMediaStream(null)
  }

  if (!session || !talkMap || mode === 'setup') {
    return <Shell><SetupScreen inputKind={inputKind} setInputKind={setInputKind} inputText={inputText} setInputText={setInputText} onSubmit={createSpeakingSession} isSubmitting={isSubmitting} error={error} /></Shell>
  }

  return <Shell>
    {mode === 'map' && <TalkMapScreen talkMap={talkMap} setTalkMap={(nextTalkMap) => dispatchProgress({ type: 'set-talk-map', talkMap: nextTalkMap })} onContinue={async () => { try { const saved = await updateTalkMap({ ...session, talk_map: talkMap }); setSession(saved); dispatchProgress({ type: 'set-talk-map', talkMap: saved.talk_map }); setMode('ready') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Talk Map could not be saved.') } }} error={error} />}
    {mode === 'ready' && <ReadyScreen videoRef={videoRef} cameraReady={cameraReady} onRequestCamera={requestCamera} onStart={startRecording} error={error} />}
    {mode === 'recording' && <RecordingScreen videoRef={videoRef} talkMap={talkMap} activeIndex={activeIndex} flowState={realtimeAssistant.flowState} assistant={realtimeAssistant.view} recordingSeconds={recordingSeconds} sttStatus={sttStatus} isListening={isListening} onHint={showManualHint} onStop={finishRecording} />}
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

function RecordingScreen({ videoRef, talkMap, activeIndex, flowState, assistant, recordingSeconds, sttStatus, isListening, onHint, onStop }: { videoRef: RefObject<HTMLVideoElement | null>; talkMap: TalkMap; activeIndex: number; flowState: FlowState; assistant: AssistantView; recordingSeconds: number; sttStatus: string; isListening: boolean; onHint: () => void; onStop: () => void }) {
  const node = talkMap.nodes[activeIndex]
  const assistantStatus = flowState === 'STUCK'
    ? 'A cue is ready'
    : isListening ? 'Listening' : sttStatus
  return <section className="recording-page"><div className="recording-video"><video ref={videoRef} autoPlay muted playsInline /><span className="recording-indicator"><i />REC {formatDuration(recordingSeconds)}</span><div className="recording-status">{assistantStatus}</div>{assistant.hint && <aside className={`hint-card${assistant.status === 'hidden' ? ' is-hidden' : ''}`} aria-live="polite" aria-hidden={assistant.status === 'hidden'}><span className="hint-label">Try this</span><strong>{assistant.hint.starter}</strong><p>{assistant.hint.nextIdea}</p><small>{assistant.status === 'visible' && assistant.personalizing ? 'Personalizing…' : 'Keep it in your own words.'}</small></aside>}<div className="recording-controls"><button type="button" onClick={onHint} aria-label="Show a hint"><span>?</span> Hint</button><button type="button" className="stop-button" onClick={onStop}>Stop recording</button></div></div><div className="recording-map"><p className="eyebrow">Current idea</p><h2>{node?.title}</h2><p>{node?.intent}</p><div className="mini-map">{talkMap.nodes.map((item) => <span key={item.id} className={item.status} />)}</div></div></section>
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

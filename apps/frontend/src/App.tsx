import { useEffect, useRef, useState, type CSSProperties } from 'react'
import './App.css'
import lightLogo from './assets/suaraai-logo-light.png'
import darkLogo from './assets/suaraai-logo-dark.png'

type VoiceStage = 'idle' | 'connecting' | 'listening' | 'transcript' | 'searching' | 'error'
type ThemePreference = 'system' | 'light' | 'dark'
type SearchResult = { title: string; url: string; domain: string; snippet: string; favicon_url: string | null; image_url: string | null; published_date: string | null; score: number | null }

const workletSource = `class PcmProcessor extends AudioWorkletProcessor { process(inputs) { const channel = inputs[0]?.[0]; if (channel) this.port.postMessage(channel); return true; } } registerProcessor('suaraai-pcm', PcmProcessor);`

function encodePcm(floatSamples: Float32Array, inputRate: number): ArrayBuffer {
  const ratio = inputRate / 16000
  const length = Math.round(floatSamples.length / ratio)
  const output = new ArrayBuffer(length * 2)
  const view = new DataView(output)
  for (let i = 0; i < length; i += 1) {
    const sample = floatSamples[Math.min(Math.floor(i * ratio), floatSamples.length - 1)]
    view.setInt16(i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true)
  }
  return output
}

function MicIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg> }
function CloseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg> }
function ArrowIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg> }

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isModalClosing, setIsModalClosing] = useState(false)
  const [theme, setTheme] = useState<ThemePreference>(() => (localStorage.getItem('suaraai-theme') as ThemePreference) || 'system')
  const [voiceStage, setVoiceStage] = useState<VoiceStage>('idle')
  const [transcript, setTranscript] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState('')
  const socketRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const nodeRef = useRef<AudioWorkletNode | null>(null)
  const flushAudioRef = useRef<(() => void) | null>(null)

  const cleanupAudio = () => { flushAudioRef.current = null; nodeRef.current?.disconnect(); sourceRef.current?.disconnect(); streamRef.current?.getTracks().forEach((track) => track.stop()); contextRef.current?.close(); nodeRef.current = null; sourceRef.current = null; streamRef.current = null; contextRef.current = null }
  const closeSocket = () => { socketRef.current?.close(); socketRef.current = null }
  const closeModal = () => { if (isModalClosing) return; cleanupAudio(); closeSocket(); setIsModalClosing(true); window.setTimeout(() => { setIsModalOpen(false); setIsModalClosing(false); setVoiceStage('idle') }, 200) }

  useEffect(() => () => { cleanupAudio(); closeSocket() }, [])
  useEffect(() => { if (!isModalOpen) return; const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeModal() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [isModalOpen])
  useEffect(() => { localStorage.setItem('suaraai-theme', theme); document.documentElement.dataset.theme = theme }, [theme])

  const startAudio = async (socket: WebSocket) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const context = new AudioContext()
    const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }))
    await context.audioWorklet.addModule(moduleUrl)
    URL.revokeObjectURL(moduleUrl)
    const source = context.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(context, 'suaraai-pcm')
    const silentGain = context.createGain(); silentGain.gain.value = 0
    const samplesPerChunk = Math.max(1, Math.round(context.sampleRate * 0.1))
    let pendingSamples = new Float32Array(samplesPerChunk)
    let pendingLength = 0
    const sendChunk = (samples: Float32Array) => { if (socket.readyState === WebSocket.OPEN) socket.send(encodePcm(samples, context.sampleRate)) }
    const appendSamples = (samples: Float32Array) => {
      let offset = 0
      while (offset < samples.length) {
        const copyLength = Math.min(samples.length - offset, samplesPerChunk - pendingLength)
        pendingSamples.set(samples.subarray(offset, offset + copyLength), pendingLength)
        pendingLength += copyLength
        offset += copyLength
        if (pendingLength === samplesPerChunk) { sendChunk(pendingSamples); pendingSamples = new Float32Array(samplesPerChunk); pendingLength = 0 }
      }
    }
    node.port.onmessage = (event: MessageEvent<Float32Array>) => { appendSamples(event.data) }
    flushAudioRef.current = () => { if (pendingLength > 0) { sendChunk(pendingSamples.slice(0, pendingLength)); pendingSamples = new Float32Array(samplesPerChunk); pendingLength = 0 } }
    source.connect(node); node.connect(silentGain); silentGain.connect(context.destination)
    streamRef.current = stream; contextRef.current = context; sourceRef.current = source; nodeRef.current = node
  }

  const openVoice = () => { setError(''); setTranscript(''); setVoiceStage('idle'); setIsModalOpen(true) }
  const beginListening = () => {
    setVoiceStage('connecting')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const apiPrefix = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'
    const socket = new WebSocket(`${protocol}//${window.location.host}${apiPrefix}/search/stream`)
    socketRef.current = socket
    socket.onopen = () => { socket.send(JSON.stringify({ type: 'start' })); startAudio(socket).catch(() => { cleanupAudio(); closeSocket(); setError('Microphone access is required to search by voice.'); setVoiceStage('error') }) }
    socket.onmessage = (event) => { const message = JSON.parse(event.data) as { type: string; text?: string; final?: boolean; items?: SearchResult[]; message?: string }; if (message.type === 'listening') setVoiceStage('listening'); if (message.type === 'transcript' && message.text) { setTranscript(message.text); if (message.final) { flushAudioRef.current?.(); cleanupAudio(); socket.send(JSON.stringify({ type: 'stop' })); setVoiceStage('transcript') } } if (message.type === 'results') { setResults(message.items ?? []); setVoiceStage('searching'); closeModal() } if (message.type === 'error') { cleanupAudio(); closeSocket(); setError(message.message ?? 'Voice search is temporarily unavailable.'); setVoiceStage('error') } }
    socket.onerror = () => { setError('Could not connect to voice search. Please try again.'); setVoiceStage('error') }
  }
  const sendSearch = () => { if (!transcript.trim() || !socketRef.current) return; setVoiceStage('searching'); socketRef.current.send(JSON.stringify({ type: 'search', query: transcript })) }
  const resetVoice = () => { cleanupAudio(); closeSocket(); setTranscript(''); setError(''); setVoiceStage('idle') }

  const effectiveLogo = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? darkLogo : lightLogo
  return <main className="app-shell"><header className="topbar"><a className="brand" href="/" aria-label="SuaraAI home"><img src={effectiveLogo} alt="SuaraAI" /></a><span className="topbar-note">Search by speaking</span></header><section className={`search-view ${results.length ? 'has-results' : ''}`}>{!results.length ? <div className="hero-copy"><p className="eyebrow">A quieter way to search</p><h1>Ask out loud.<br />Find your way.</h1><p className="hero-description">Speak naturally and let SuaraAI surface the ideas worth your time.</p></div> : <div className="results-heading"><p className="eyebrow">Your voice search</p><h1>{transcript || 'Your search results'}</h1><p className="result-count">{results.length} considered results</p></div>}<button className="voice-search" type="button" onClick={openVoice}><span className="voice-search-icon"><MicIcon /></span><span className="voice-search-copy"><strong>{results.length ? 'Ask another question' : 'Tap to speak'}</strong><small>No typing required</small></span><span className="voice-search-arrow"><ArrowIcon /></span></button>{results.length > 0 && <div className="results-list" aria-live="polite">{results.map((result, index) => <article className="result-item" key={`${result.url}-${index}`}>{result.image_url ? <img className="result-image" src={result.image_url} alt="" loading="lazy" /> : <span className="result-index">0{index + 1}</span>}<div><p className="result-source">{result.domain || 'Web result'} <span>·</span> {result.published_date || 'Source'}</p><h2><a href={result.url} target="_blank" rel="noreferrer">{result.title}</a></h2><p className="result-excerpt">{result.snippet}</p><a className="result-link" href={result.url} target="_blank" rel="noreferrer">{result.url}</a></div><ArrowIcon /></article>)}</div>}</section><footer className="footer"><span>Designed for considered questions.</span><label className="theme-picker">Theme <select value={theme} onChange={(event) => setTheme(event.target.value as ThemePreference)} aria-label="Choose color theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><span>SuaraAI / 2026</span></footer>{isModalOpen && <div className={`modal-backdrop ${isModalClosing ? 'is-closing' : ''}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}><section className="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-modal-title"><button className="close-button" type="button" onClick={closeModal} aria-label="Close voice search"><CloseIcon /></button><p className="eyebrow">Voice search</p><h2 id="voice-modal-title">{voiceStage === 'idle' && 'What would you like to know?'}{voiceStage === 'connecting' && 'Connecting securely.'}{voiceStage === 'listening' && 'I’m listening.'}{voiceStage === 'transcript' && 'Here’s what I heard.'}{voiceStage === 'searching' && 'Searching the web.'}{voiceStage === 'error' && 'Something interrupted your search.'}</h2><div className={`voice-orb ${voiceStage}`} aria-hidden="true"><MicIcon /><div className="waveform">{[10, 18, 28, 16, 34, 20, 12].map((height, index) => <span key={index} style={{ '--bar-height': `${height}px` } as CSSProperties} />)}</div></div><p className="voice-status" aria-live="polite">{error || (voiceStage === 'idle' && 'SuaraAI keeps this preview focused on your question.') || (voiceStage === 'connecting' && 'Preparing a secure voice session…') || (voiceStage === 'listening' && (transcript || 'Say a question in your own words.')) || (voiceStage === 'transcript' && `“${transcript}”`) || (voiceStage === 'searching' && 'Finding the most useful sources…')}</p><div className="modal-actions">{voiceStage === 'idle' && <button className="text-action primary-action" type="button" onClick={beginListening}>Start listening <ArrowIcon /></button>}{voiceStage === 'connecting' && <span className="processing-label">Connecting</span>}{voiceStage === 'listening' && <button className="text-action primary-action" type="button" onClick={() => { flushAudioRef.current?.(); cleanupAudio(); socketRef.current?.send(JSON.stringify({ type: 'stop' })); setVoiceStage('transcript') }}>Done <ArrowIcon /></button>}{voiceStage === 'transcript' && <><button className="text-action" type="button" onClick={resetVoice}>Try again</button><button className="text-action primary-action" type="button" onClick={sendSearch}>Search <ArrowIcon /></button></>}{voiceStage === 'error' && <button className="text-action primary-action" type="button" onClick={resetVoice}>Try again <ArrowIcon /></button>}</div></section></div>}</main>
}

export default App

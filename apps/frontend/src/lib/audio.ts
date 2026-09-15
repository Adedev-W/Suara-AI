import type { SpeechPauseDetection } from '../domain/types'

const workletSource = `class SuaraPcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel) this.port.postMessage(channel)
    return true
  }
}
registerProcessor('suaraai-pcm', SuaraPcmProcessor)`

export function encodePcm(floatSamples: Float32Array, inputRate: number): ArrayBuffer {
  const ratio = inputRate / 16_000
  const length = Math.max(1, Math.round(floatSamples.length / ratio))
  const output = new ArrayBuffer(length * 2)
  const view = new DataView(output)
  for (let index = 0; index < length; index += 1) {
    const source = floatSamples[Math.min(Math.floor(index * ratio), floatSamples.length - 1)] ?? 0
    const sample = Math.max(-1, Math.min(1, source))
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return output
}

export type AudioPipeline = {
  flush: () => void; close: () => void; startedAt: number
  confirmSpeech: (endMs: number) => void; setConnected: (connected: boolean) => void
}

export type AudioPipelineOptions = {
  onPcmChunk: (chunk: ArrayBuffer) => void
  onSpeechStarted: () => void
  onStuck: (detection: SpeechPauseDetection) => void
  pauseThreshold: (connected: boolean) => number
}

/** Sample durations, not message delivery cadence, define the acoustic timeline. */
export class SpeechPauseDetector {
  private elapsedMs = 0
  private activeMs = 0
  private silenceMs = 0
  private state: 'waiting' | 'speaking' | 'stuck' = 'waiting'
  private noiseFloor = 0.001
  private connected = false
  private confirmedEnd = -1
  private consumedEnd = -1
  private readonly onSpeechStarted: () => void
  private readonly onStuck: (detection: SpeechPauseDetection) => void
  private readonly threshold: (connected: boolean) => number
  private readonly startedAt: number
  private readonly wallNow: () => number

  constructor(onSpeechStarted: () => void, onStuck: (detection: SpeechPauseDetection) => void,
    threshold: (connected: boolean) => number = () => 1500,
    startedAt = Date.now(), wallNow: () => number = Date.now) {
    this.onSpeechStarted = onSpeechStarted
    this.onStuck = onStuck
    this.threshold = threshold
    this.startedAt = startedAt
    this.wallNow = wallNow
  }

  confirmSpeech(endMs: number): void { this.confirmedEnd = Math.max(this.confirmedEnd, endMs) }
  setConnected(connected: boolean): void { this.connected = connected }

  observe(rms: number, durationMs = 50): void {
    this.elapsedMs += durationMs
    const threshold = Math.max(0.004, this.noiseFloor * (this.activeMs > 0 ? 2 : 3))
    if (rms < threshold) this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02
    if (rms >= threshold) {
      this.silenceMs = 0
      this.activeMs += durationMs
      if (this.activeMs >= 200 && this.state !== 'speaking') {
        this.state = 'speaking'
        this.onSpeechStarted()
      }
      return
    }
    this.activeMs = 0
    if (this.state !== 'speaking') return
    this.silenceMs += durationMs
    if (this.silenceMs < this.threshold(this.connected)) return
    if (this.connected && this.confirmedEnd <= this.consumedEnd) return
    this.state = 'stuck'
    // Late finalization of the same utterance must not rearm a noise-only episode.
    this.consumedEnd = Math.max(this.confirmedEnd, this.elapsedMs - this.silenceMs + 100)
    this.onStuck({
      startedAt: this.startedAt + this.elapsedMs - this.silenceMs,
      detectedAt: this.wallNow(), durationMs: this.silenceMs,
    })
  }
}

async function loadAudioWorklet(context: AudioContext): Promise<void> {
  const sourceUrl = URL.createObjectURL(
    new Blob([workletSource], { type: 'application/javascript' }),
  )
  try {
    await context.audioWorklet.addModule(sourceUrl)
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

export async function createAudioPipeline(
  stream: MediaStream,
  options: AudioPipelineOptions,
): Promise<AudioPipeline> {
  const context = new AudioContext()
  try {
    await context.resume()
    await loadAudioWorklet(context)
  } catch (cause) {
    void context.close()
    throw cause
  }

  const startedAt = Date.now()
  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'suaraai-pcm')
  const silentGain = context.createGain()
  silentGain.gain.value = 0
  const samplesPerChunk = Math.max(1, Math.round(context.sampleRate * 0.05))
  let pending = new Float32Array(samplesPerChunk)
  let pendingLength = 0
  const speechDetector = new SpeechPauseDetector(options.onSpeechStarted, options.onStuck, options.pauseThreshold, startedAt)
  speechDetector.setConnected(true)

  const send = (samples: Float32Array) => {
    const sumOfSquares = samples.reduce((total, sample) => total + sample * sample, 0)
    const rms = Math.sqrt(sumOfSquares / Math.max(1, samples.length))
    speechDetector.observe(rms, samples.length / context.sampleRate * 1000)
    options.onPcmChunk(encodePcm(samples, context.sampleRate))
  }
  const append = (samples: Float32Array) => {
    let offset = 0
    while (offset < samples.length) {
      const copyLength = Math.min(samples.length - offset, samplesPerChunk - pendingLength)
      pending.set(samples.subarray(offset, offset + copyLength), pendingLength)
      pendingLength += copyLength
      offset += copyLength
      if (pendingLength === samplesPerChunk) {
        send(pending)
        pending = new Float32Array(samplesPerChunk)
        pendingLength = 0
      }
    }
  }

  node.port.onmessage = (event: MessageEvent<Float32Array>) => append(event.data)
  source.connect(node)
  node.connect(silentGain)
  silentGain.connect(context.destination)

  return {
    startedAt,
    confirmSpeech: (endMs) => speechDetector.confirmSpeech(endMs),
    setConnected: (connected) => speechDetector.setConnected(connected),
    flush: () => {
      if (pendingLength > 0) send(pending.slice(0, pendingLength))
      pending = new Float32Array(samplesPerChunk)
      pendingLength = 0
    },
    close: () => {
      node.port.onmessage = null
      node.disconnect()
      source.disconnect()
      silentGain.disconnect()
      void context.close()
    },
  }
}

export function selectRecordingMimeType(): string | undefined {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
}

export function createVideoRecorder(stream: MediaStream, onChunk: (chunk: Blob) => void): MediaRecorder {
  const mimeType = selectRecordingMimeType()
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) onChunk(event.data)
  }
  recorder.start(250)
  return recorder
}

export function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop())
}

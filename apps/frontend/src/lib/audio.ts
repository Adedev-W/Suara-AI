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

export type AudioPipeline = { flush: () => void; close: () => void }

export type AudioPipelineOptions = {
  onPcmChunk: (chunk: ArrayBuffer) => void
  onSpeechStarted: () => void
  onStuck: () => void
}

const MIN_SPEECH_RMS = 0.015
// Requiring 200 ms of activity prevents clicks and handling noise from rearming a hint episode.
const REQUIRED_ACTIVE_CHUNKS = 2
// Audio is evaluated in 100 ms chunks, so 15 silent chunks represent 1.5 seconds.
const REQUIRED_SILENT_CHUNKS = 15

type SpeechState = 'waiting' | 'speaking' | 'stuck'

export class SpeechPauseDetector {
  private state: SpeechState = 'waiting'
  private activeChunks = 0
  private silentChunks = 0
  private readonly onSpeechStarted: () => void
  private readonly onStuck: () => void

  constructor(onSpeechStarted: () => void, onStuck: () => void) {
    this.onSpeechStarted = onSpeechStarted
    this.onStuck = onStuck
  }

  observe(rms: number): void {
    if (rms >= MIN_SPEECH_RMS) {
      this.silentChunks = 0
      this.activeChunks += 1
      if (this.activeChunks === REQUIRED_ACTIVE_CHUNKS) {
        this.state = 'speaking'
        this.onSpeechStarted()
      }
      return
    }

    this.activeChunks = 0
    if (this.state !== 'speaking') return
    this.silentChunks += 1
    if (this.silentChunks >= REQUIRED_SILENT_CHUNKS) {
      this.state = 'stuck'
      this.onStuck()
    }
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

  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'suaraai-pcm')
  const silentGain = context.createGain()
  silentGain.gain.value = 0
  const samplesPerChunk = Math.max(1, Math.round(context.sampleRate * 0.1))
  let pending = new Float32Array(samplesPerChunk)
  let pendingLength = 0
  const speechDetector = new SpeechPauseDetector(options.onSpeechStarted, options.onStuck)

  const send = (samples: Float32Array) => {
    const sumOfSquares = samples.reduce((total, sample) => total + sample * sample, 0)
    const rms = Math.sqrt(sumOfSquares / Math.max(1, samples.length))
    speechDetector.observe(rms)
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

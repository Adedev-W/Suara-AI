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

export async function connectAudioToSocket(
  stream: MediaStream,
  socket: WebSocket,
): Promise<AudioPipeline> {
  const context = new AudioContext()
  await context.resume()
  const sourceUrl = URL.createObjectURL(new Blob([workletSource], { type: 'application/javascript' }))
  await context.audioWorklet.addModule(sourceUrl)
  URL.revokeObjectURL(sourceUrl)

  const source = context.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(context, 'suaraai-pcm')
  const silentGain = context.createGain()
  silentGain.gain.value = 0
  const samplesPerChunk = Math.max(1, Math.round(context.sampleRate * 0.1))
  let pending = new Float32Array(samplesPerChunk)
  let pendingLength = 0

  const send = (samples: Float32Array) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(encodePcm(samples, context.sampleRate))
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

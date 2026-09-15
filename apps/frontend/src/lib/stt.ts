import { getSttToken } from './api'
import { parseSttMessage, type SttMessage } from './sttProtocol'
export { parseSttMessage } from './sttProtocol'

export async function openAssemblySocket(onMessage: (message: SttMessage) => void): Promise<WebSocket> {
  const controller = new AbortController()
  const tokenTimeout = window.setTimeout(() => controller.abort(), 8000)
  const { token, speech_model: speechModel } = await getSttToken(controller.signal)
    .finally(() => window.clearTimeout(tokenTimeout))
  const params = new URLSearchParams({ token, speech_model: speechModel,
    sample_rate: '16000', encoding: 'pcm_s16le', min_turn_silence: '128', max_turn_silence: '800' })
  if (speechModel === 'universal-3-5-pro') {
    params.set('mode', 'balanced')
    params.set('continuous_partials', 'true')
  }
  const socket = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params}`)
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => fail(new Error('Speech initialization timed out.')), 8000)
      const fail = (error: Error) => { window.clearTimeout(timeout); reject(error) }
      socket.onmessage = (event) => {
        const message = parseSttMessage(String(event.data))
        if (!message) return
        if (message.type === 'Begin') {
          if (message.model && message.model !== speechModel) {
            fail(new Error('Speech service selected an unexpected model.'))
            socket.close()
            return
          }
          window.clearTimeout(timeout)
          resolve()
        }
        if (message.type === 'Error') fail(new Error(message.detail))
        onMessage(message)
      }
      socket.addEventListener('error', () => fail(new Error('Speech connection failed.')), { once: true })
      socket.addEventListener('close', () => fail(new Error('Speech connection closed.')), { once: true })
    })
    return socket
  } catch (cause) { socket.close(); throw cause }
}

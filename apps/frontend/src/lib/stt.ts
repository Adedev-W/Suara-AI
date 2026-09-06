import { getSttToken } from './api'
import type { SttTurn } from '../domain/types'

export async function openAssemblySocket(speechModel = 'universal-3-5-pro'): Promise<WebSocket> {
  const tokenResponse = await getSttToken()
  const token = tokenResponse.token
  speechModel = tokenResponse.speech_model || speechModel
  const params = new URLSearchParams({
    token,
    speech_model: speechModel,
    sample_rate: '16000',
    encoding: 'pcm_s16le',
  })
  const socket = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${params.toString()}`)
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener(
        'error',
        () => reject(new Error('Could not connect to speech transcription.')),
        { once: true },
      )
      socket.addEventListener(
        'close',
        () => reject(new Error('Speech transcription closed before it connected.')),
        { once: true },
      )
    })
    return socket
  } catch (cause) {
    socket.close()
    throw cause
  }
}

export function parseSttMessage(data: string): SttTurn | null {
  try {
    const message = JSON.parse(data) as Partial<SttTurn>
    if (message.type !== 'Turn') return null
    return {
      type: 'Turn',
      transcript: typeof message.transcript === 'string' ? message.transcript : undefined,
      end_of_turn: message.end_of_turn === true,
    }
  } catch {
    return null
  }
}

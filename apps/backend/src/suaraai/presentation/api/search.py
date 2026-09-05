import contextlib
import json
from dataclasses import asdict
from typing import Any

from assemblyai.streaming.v3 import (  # type: ignore[import-untyped]
    AsyncRealTimeTranscriber,
    Encoding,
    RealTimeError,
    RealTimeEvents,
    RealTimeParameters,
    RealTimeTranscriberOptions,
    TurnEvent,
)
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from suaraai.application.search_voice import SearchConfigurationError, SearchVoice
from suaraai.infrastructure.settings import Settings


def create_search_router(settings: Settings) -> APIRouter:
    router = APIRouter(prefix="/search", tags=["search"])

    @router.websocket("/stream")
    async def stream_search(websocket: WebSocket) -> None:
        await websocket.accept()
        transcriber: AsyncRealTimeTranscriber | None = None
        search_service: SearchVoice | None = None
        final_transcript = ""
        audio_buffer = bytearray()
        min_audio_bytes = 1600
        target_audio_bytes = 3200
        max_audio_bytes = 32000

        async def send_transcript(_: Any, event: TurnEvent) -> None:
            nonlocal final_transcript
            if event.transcript:
                if event.end_of_turn:
                    final_transcript = event.transcript.strip()
                await websocket.send_json(
                    {"type": "transcript", "text": event.transcript, "final": event.end_of_turn}
                )

        async def send_transcription_error(_: Any, error: RealTimeError) -> None:
            await websocket.send_json(
                {
                    "type": "error",
                    "code": "upstream",
                    "message": "Voice transcription was interrupted. Please try again.",
                }
            )

        async def stream_buffered_audio() -> None:
            if transcriber is None:
                return
            while len(audio_buffer) >= target_audio_bytes:
                chunk = bytes(audio_buffer[:target_audio_bytes])
                del audio_buffer[:target_audio_bytes]
                await transcriber.stream(chunk)

        async def flush_audio_buffer() -> None:
            if transcriber is None or not audio_buffer:
                return
            if len(audio_buffer) < min_audio_bytes:
                audio_buffer.extend(b"\x00" * (min_audio_bytes - len(audio_buffer)))
            while audio_buffer:
                chunk_size = min(len(audio_buffer), max_audio_bytes)
                chunk = bytes(audio_buffer[:chunk_size])
                del audio_buffer[:chunk_size]
                await transcriber.stream(chunk)

        try:
            await websocket.send_json({"type": "ready"})
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    if transcriber is not None:
                        audio = message["bytes"]
                        if not audio or len(audio) % 2:
                            await websocket.send_json(
                                {
                                    "type": "error",
                                    "code": "invalid_audio",
                                    "message": "Audio data must contain 16-bit PCM samples.",
                                }
                            )
                            continue
                        audio_buffer.extend(audio)
                        await stream_buffered_audio()
                    continue

                payload = message.get("text")
                if payload is None:
                    continue
                command = json.loads(payload)
                command_type = command.get("type")
                if command_type == "start":
                    if not settings.assemblyai_api_key:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "code": "configuration",
                                "message": "Voice search is not configured.",
                            }
                        )
                        continue
                    transcriber = AsyncRealTimeTranscriber(
                        RealTimeTranscriberOptions(api_key=settings.assemblyai_api_key),
                    )
                    transcriber.on(RealTimeEvents.Turn, send_transcript)
                    transcriber.on(RealTimeEvents.Error, send_transcription_error)
                    await transcriber.connect(
                        RealTimeParameters(sample_rate=16000, encoding=Encoding.pcm_s16le)
                    )
                    await websocket.send_json({"type": "listening"})
                elif command_type == "stop" and transcriber is not None:
                    await flush_audio_buffer()
                    await transcriber.disconnect(terminate=True)
                    transcriber = None
                elif command_type == "search":
                    query = str(command.get("query") or final_transcript).strip()
                    try:
                        search_service = SearchVoice(
                            settings.tavily_api_key, settings.tavily_max_results
                        )
                        results = await search_service.execute(query)
                    except SearchConfigurationError:
                        await websocket.send_json(
                            {
                                "type": "error",
                                "code": "configuration",
                                "message": "Search is not configured.",
                            }
                        )
                        continue
                    await websocket.send_json(
                        {
                            "type": "results",
                            "query": query,
                            "items": [asdict(result) for result in results],
                        }
                    )
                else:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "invalid_message",
                            "message": "Unsupported voice search message.",
                        }
                    )
        except WebSocketDisconnect:
            pass
        except Exception:
            with contextlib.suppress(Exception):
                await websocket.send_json(
                    {
                        "type": "error",
                        "code": "upstream",
                        "message": "Voice search is temporarily unavailable.",
                    }
                )
        finally:
            if transcriber is not None:
                with contextlib.suppress(Exception):
                    await transcriber.disconnect(terminate=True)
            if search_service is not None:
                with contextlib.suppress(Exception):
                    await search_service.close()

    return router

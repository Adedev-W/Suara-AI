import contextlib
import json
from dataclasses import asdict
from typing import Any

from assemblyai.streaming.v3 import (  # type: ignore[import-untyped]
    AsyncRealTimeTranscriber,
    Encoding,
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

        async def send_transcript(_: Any, event: TurnEvent) -> None:
            nonlocal final_transcript
            if event.transcript:
                if event.end_of_turn:
                    final_transcript = event.transcript.strip()
                await websocket.send_json(
                    {"type": "transcript", "text": event.transcript, "final": event.end_of_turn}
                )

        try:
            await websocket.send_json({"type": "ready"})
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    if transcriber is not None:
                        await transcriber.stream(message["bytes"])
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
                    await transcriber.connect(
                        RealTimeParameters(sample_rate=16000, encoding=Encoding.pcm_s16le)
                    )
                    await websocket.send_json({"type": "listening"})
                elif command_type == "stop" and transcriber is not None:
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

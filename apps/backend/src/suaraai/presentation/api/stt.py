from __future__ import annotations

from fastapi import APIRouter, HTTPException

from suaraai.infrastructure.assemblyai import AssemblyAISpeechTokenService, SpeechConfigurationError
from suaraai.presentation.api.schemas import SttTokenResponse


def create_stt_router(token_service: AssemblyAISpeechTokenService) -> APIRouter:
    router = APIRouter(prefix="/stt", tags=["speech"])

    @router.post("/token", response_model=SttTokenResponse)
    async def create_token() -> SttTokenResponse:
        try:
            token, expires_in_seconds, speech_model = await token_service.create_token()
        except SpeechConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return SttTokenResponse(
            token=token,
            expires_in_seconds=expires_in_seconds,
            speech_model=speech_model,
        )

    return router

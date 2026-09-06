from __future__ import annotations

import asyncio
from typing import cast

from assemblyai.streaming.v3 import RealTimeTranscriber


class SpeechConfigurationError(RuntimeError):
    pass


class AssemblyAISpeechTokenService:
    def __init__(
        self,
        api_key: str | None,
        token_ttl_seconds: int = 60,
        speech_model: str = "universal-3-5-pro",
    ) -> None:
        self._api_key = api_key
        self._token_ttl_seconds = token_ttl_seconds
        self._speech_model = speech_model

    async def create_token(self) -> tuple[str, int, str]:
        if not self._api_key:
            raise SpeechConfigurationError("Speech service is not configured")
        if not 1 <= self._token_ttl_seconds <= 600:
            raise SpeechConfigurationError(
                "Speech token lifetime must be between 1 and 600 seconds"
            )
        try:
            token = await asyncio.to_thread(self._create_token)
        except Exception as exc:
            raise SpeechConfigurationError("Speech service could not issue a token") from exc
        return token, self._token_ttl_seconds, self._speech_model

    def _create_token(self) -> str:
        client = RealTimeTranscriber(api_key=cast(str, self._api_key))
        return cast(
            str,
            client.create_temporary_token(expires_in_seconds=self._token_ttl_seconds),
        )

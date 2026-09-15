from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from dataclasses import replace

from suaraai.application.ports import HintGenerator
from suaraai.domain.copilot import Hint, HintContext, TalkMap
from suaraai.infrastructure.llm_gateway import LlmProviderError

logger = logging.getLogger(__name__)


class ResilientHintGenerator:
    """Keep the rescue path usable when the optional LLM provider is unavailable."""

    def __init__(self, primary: HintGenerator, fallback: HintGenerator) -> None:
        self._primary = primary
        self._fallback = fallback

    async def generate_hint(
        self,
        talk_map: TalkMap,
        active_index: int,
        recent_transcript: str,
        covered_keywords: Sequence[str],
        previous_hints: Sequence[str],
        context: HintContext | None = None,
    ) -> Hint:
        try:
            # HTTP read timeouts reset per read; this deadline also bounds all retries.
            async with asyncio.timeout(3.0):
                return await self._primary.generate_hint(
                    talk_map,
                    active_index,
                    recent_transcript,
                    covered_keywords,
                    previous_hints,
                    context,
                )
        except (LlmProviderError, TimeoutError) as exc:
            logger.warning(
                "Realtime AI hint unavailable; using deterministic fallback: %s",
                (
                    exc.diagnostic_message
                    if isinstance(exc, LlmProviderError)
                    else "deadline exceeded"
                ),
            )
            fallback = await self._fallback.generate_hint(
                talk_map,
                active_index,
                recent_transcript,
                covered_keywords,
                previous_hints,
                context,
            )
            return replace(
                fallback,
                generation_status=(
                    "timeout" if isinstance(exc, TimeoutError) else "provider_fallback"
                ),
            )

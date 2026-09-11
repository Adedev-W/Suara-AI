from __future__ import annotations

import logging
from collections.abc import Sequence

from suaraai.application.ports import HintGenerator
from suaraai.domain.copilot import Hint, TalkMap
from suaraai.infrastructure.llm_gateway import LlmGatewayError

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
    ) -> Hint:
        try:
            return await self._primary.generate_hint(
                talk_map,
                active_index,
                recent_transcript,
                covered_keywords,
                previous_hints,
            )
        except LlmGatewayError as exc:
            logger.warning(
                "Realtime AI hint unavailable; using deterministic fallback: %s",
                exc.diagnostic_message,
            )
            return await self._fallback.generate_hint(
                talk_map,
                active_index,
                recent_transcript,
                covered_keywords,
                previous_hints,
            )

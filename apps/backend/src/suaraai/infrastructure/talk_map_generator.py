from __future__ import annotations

import logging

from suaraai.application.ports import TalkMapGenerator
from suaraai.domain.copilot import InputKind, TalkMap
from suaraai.infrastructure.llm_gateway import LlmGatewayError

logger = logging.getLogger(__name__)


class ResilientTalkMapGenerator:
    """Keep session preparation available when the LLM cannot produce a usable map."""

    def __init__(self, primary: TalkMapGenerator, fallback: TalkMapGenerator) -> None:
        self._primary = primary
        self._fallback = fallback

    async def generate(self, input_kind: InputKind, input_text: str) -> TalkMap:
        try:
            return await self._primary.generate(input_kind, input_text)
        except LlmGatewayError as exc:
            logger.warning(
                "Talk Map generation unavailable; using deterministic fallback: %s",
                exc.diagnostic_message,
            )
            return await self._fallback.generate(input_kind, input_text)

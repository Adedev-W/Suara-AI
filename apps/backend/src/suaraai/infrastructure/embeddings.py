from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Any


class LocalEmbeddingService:
    def __init__(self, model_name: str) -> None:
        self._model_name = model_name
        self._model: Any = None

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return await asyncio.to_thread(self._embed_sync, list(texts))

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        if self._model is None:
            from fastembed import TextEmbedding

            self._model = TextEmbedding(model_name=self._model_name)
        return [list(map(float, vector)) for vector in self._model.embed(texts)]

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, File, Header, HTTPException, UploadFile

from suaraai.application.knowledge import (
    KnowledgeInputError,
    KnowledgeService,
    KnowledgeSessionNotFoundError,
)
from suaraai.infrastructure.llm_gateway import LlmGatewayError
from suaraai.presentation.api.schemas import (
    DocumentIngestResponse,
    KnowledgeQueryRequest,
    KnowledgeQueryResponse,
    KnowledgeSourcePayload,
)


def create_knowledge_router(knowledge: KnowledgeService) -> APIRouter:
    router = APIRouter(prefix="/knowledge", tags=["knowledge"])

    @router.post("/documents", response_model=DocumentIngestResponse)
    async def ingest_document(
        session_id: UUID,
        file: Annotated[UploadFile, File()],
        x_session_token: str | None = Header(default=None),
    ) -> DocumentIngestResponse:
        if not x_session_token:
            raise HTTPException(status_code=401, detail="Session token is required")
        data = await file.read()
        try:
            count = await knowledge.ingest(
                session_id,
                x_session_token,
                file.filename or "uploaded-document",
                file.content_type,
                data,
            )
        except KnowledgeSessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except KnowledgeInputError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        return DocumentIngestResponse(
            source_name=file.filename or "uploaded-document", chunk_count=count
        )

    @router.post("/query", response_model=KnowledgeQueryResponse)
    async def query_knowledge(
        session_id: UUID,
        request: KnowledgeQueryRequest,
        x_session_token: str | None = Header(default=None),
    ) -> KnowledgeQueryResponse:
        if not x_session_token:
            raise HTTPException(status_code=401, detail="Session token is required")
        try:
            answer, context = await knowledge.answer(session_id, x_session_token, request.question)
        except KnowledgeSessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except KnowledgeInputError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except LlmGatewayError as exc:
            raise HTTPException(
                status_code=502, detail="Knowledge answer generation failed"
            ) from exc
        return KnowledgeQueryResponse(
            answer=answer,
            sources=[
                KnowledgeSourcePayload(
                    source_name=item.source_name,
                    page_number=item.page_number,
                    score=item.score,
                )
                for item in context
            ],
        )

    return router

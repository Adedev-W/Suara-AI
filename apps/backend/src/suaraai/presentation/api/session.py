from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, status

from suaraai.application.session import (
    CompleteSession,
    PrepareSession,
    SessionInputError,
    SessionNotFoundError,
    UpdateTalkMap,
)
from suaraai.infrastructure.llm_gateway import LlmGatewayError
from suaraai.presentation.api.schemas import (
    CompleteSessionRequest,
    CompleteSessionResponse,
    FeedbackPayload,
    SessionPrepareRequest,
    SessionResponse,
    UpdateTalkMapRequest,
)

logger = logging.getLogger(__name__)


def create_session_router(
    prepare_session: PrepareSession,
    update_talk_map: UpdateTalkMap,
    complete_session: CompleteSession,
) -> APIRouter:
    router = APIRouter(prefix="/session", tags=["session"])

    @router.post("/prepare", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
    async def prepare(request: SessionPrepareRequest) -> SessionResponse:
        try:
            session = await prepare_session.execute(request.input_kind, request.input_text)
        except SessionInputError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except LlmGatewayError as exc:
            logger.warning("Speaking plan generation failed: %s", exc)
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return SessionResponse.from_domain(session)

    @router.patch("/{session_id}/talk-map", response_model=SessionResponse)
    async def edit_talk_map(
        session_id: str,
        request: UpdateTalkMapRequest,
        x_session_token: str | None = Header(default=None),
    ) -> SessionResponse:
        token = _require_token(x_session_token)
        try:
            session = await update_talk_map.execute(
                UUID(session_id), token, request.talk_map.to_domain()
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return SessionResponse.from_domain(session)

    @router.post("/{session_id}/complete", response_model=CompleteSessionResponse)
    async def complete(
        session_id: str,
        request: CompleteSessionRequest,
        x_session_token: str | None = Header(default=None),
    ) -> CompleteSessionResponse:
        token = _require_token(x_session_token)
        try:
            parsed_session_id = UUID(session_id)
            _, feedback = await complete_session.execute(
                parsed_session_id, token, request.transcript, request.state_events
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except SessionNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except LlmGatewayError as exc:
            logger.warning("Speaking feedback generation failed: %s", exc)
            raise HTTPException(
                status_code=502, detail=str(exc)
            ) from exc
        return CompleteSessionResponse(
            session_id=parsed_session_id,
            feedback=FeedbackPayload.from_domain(feedback),
        )

    return router


def _require_token(token: str | None) -> str:
    if not token:
        raise HTTPException(status_code=401, detail="Session token is required")
    return token

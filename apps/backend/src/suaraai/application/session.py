from __future__ import annotations

import secrets
from collections.abc import Sequence
from dataclasses import replace
from uuid import UUID

from suaraai.application.ports import (
    FeedbackGenerator,
    HintGenerator,
    SessionRepository,
    TalkMapGenerator,
)
from suaraai.domain.copilot import (
    Feedback,
    Hint,
    HintContext,
    InputKind,
    NodeStatus,
    Session,
    TalkMap,
)


class SessionInputError(ValueError):
    pass


class SessionNotFoundError(LookupError):
    pass


class PrepareSession:
    def __init__(self, repository: SessionRepository, generator: TalkMapGenerator) -> None:
        self._repository = repository
        self._generator = generator

    async def execute(self, input_kind: InputKind, input_text: str) -> Session:
        cleaned = input_text.strip()
        if not cleaned:
            raise SessionInputError("Topic or notes are required")
        talk_map = await self._generator.generate(input_kind, cleaned)
        if not 3 <= len(talk_map.nodes) <= 7:
            raise SessionInputError("Talk Map must contain between 3 and 7 nodes")
        talk_map.nodes[0].status = NodeStatus.ACTIVE
        session = Session.create(
            input_kind=input_kind,
            input_text=cleaned,
            talk_map=talk_map,
            access_token=secrets.token_urlsafe(32),
        )
        await self._repository.save(session)
        return session


class UpdateTalkMap:
    def __init__(self, repository: SessionRepository) -> None:
        self._repository = repository

    async def execute(self, session_id: UUID, access_token: str, talk_map: TalkMap) -> Session:
        if not 3 <= len(talk_map.nodes) <= 7:
            raise SessionInputError("Talk Map must contain between 3 and 7 nodes")
        session = await self._repository.get(session_id, access_token)
        if session is None:
            raise SessionNotFoundError("Session was not found")
        for index, node in enumerate(talk_map.nodes):
            if node.status == NodeStatus.COVERED and index != 0:
                continue
            node.status = NodeStatus.ACTIVE if index == 0 else NodeStatus.UPCOMING
        session.talk_map = talk_map
        await self._repository.update(session)
        return session


class CompleteSession:
    def __init__(self, repository: SessionRepository, feedback_generator: FeedbackGenerator):
        self._repository = repository
        self._feedback_generator = feedback_generator

    async def execute(
        self,
        session_id: UUID,
        access_token: str,
        transcript: str,
        state_events: Sequence[dict[str, object]],
    ) -> tuple[Session, Feedback]:
        session = await self._repository.get(session_id, access_token)
        if session is None:
            raise SessionNotFoundError("Session was not found")
        cleaned_transcript = transcript.strip()
        if not cleaned_transcript:
            raise SessionInputError("A final transcript is required")
        feedback = await self._feedback_generator.generate_feedback(
            cleaned_transcript, session.talk_map
        )
        session.final_transcript = cleaned_transcript
        session.state_events = list(state_events)
        session.feedback = {
            "summary": feedback.summary,
            "strengths": feedback.strengths,
            "improvements": feedback.improvements,
            "examples": feedback.examples,
            "next_practice": feedback.next_practice,
        }
        await self._repository.update(session)
        return session, feedback


class GenerateHint:
    def __init__(self, repository: SessionRepository, generator: HintGenerator) -> None:
        self._repository = repository
        self._generator = generator

    async def execute(
        self,
        session_id: UUID,
        access_token: str,
        active_index: int,
        recent_transcript: str,
        covered_keywords: list[str],
        previous_hints: list[str],
        final_transcript: str = "",
        context_id: str = "",
    ) -> Hint:
        session = await self._repository.get(session_id, access_token)
        if session is None:
            raise SessionNotFoundError("Session was not found")
        if not session.talk_map.nodes:
            raise SessionInputError("A Talk Map is required before requesting a hint")
        if not 0 <= active_index < len(session.talk_map.nodes):
            raise SessionInputError("Active Talk Map index is out of range")
        generated = await self._generator.generate_hint(
            session.talk_map,
            active_index,
            recent_transcript.strip(),
            covered_keywords,
            previous_hints,
            HintContext(session.input_text, final_transcript, context_id),
        )
        # A model suggestion cannot advance permanent progress without spoken evidence.
        if generated.node_id not in {node.id for node in session.talk_map.nodes}:
            generated = replace(generated, node_id=session.talk_map.nodes[active_index].id)
        if (
            not generated.evidence
            or generated.evidence.casefold() not in final_transcript.casefold()
        ):
            generated = replace(generated, evidence="")
        return generated

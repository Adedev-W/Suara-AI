from __future__ import annotations

import secrets
from collections.abc import Sequence
from uuid import UUID

from suaraai.application.flow import mark_active_node
from suaraai.application.ports import FeedbackGenerator, SessionRepository, TalkMapGenerator
from suaraai.domain.copilot import (
    Feedback,
    InputKind,
    NodeStatus,
    Session,
    TalkMap,
    TalkMapNode,
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
        mark_active_node(talk_map, 0)
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


class DeterministicTalkMapGenerator:
    async def generate(self, input_kind: InputKind, input_text: str) -> TalkMap:
        title = input_text.splitlines()[0][:80].strip().rstrip(".") or "Speaking practice"
        concepts = [
            part.strip() for part in input_text.replace("\n", ",").split(",") if part.strip()
        ]
        while len(concepts) < 3:
            concepts.append(["context", "main idea", "result"][len(concepts)])
        concepts = concepts[:4]
        labels = ["What it is", "Why it matters", "How it works", "What I learned"]
        nodes = [
            TalkMapNode(
                id=f"node-{index + 1}",
                title=labels[index],
                intent=f"Explain {concept}",
                keywords=[concept],
                semantic_summary=f"The speaker explains {concept}.",
                starter=f"The {concept} is basically...",
                next_prompt=f"Continue with {concept}.",
            )
            for index, concept in enumerate(concepts)
        ]

        return TalkMap(title=title, nodes=nodes)


class DeterministicFeedbackGenerator:
    async def generate_feedback(self, transcript: str, talk_map: TalkMap) -> Feedback:
        covered_topics = ", ".join(node.title for node in talk_map.nodes[:3])
        return Feedback(
            summary=f"You explained your topic through {covered_topics}.",
            strengths=[
                "You completed a spoken explanation without relying on a full script.",
                "Your recording created a clear starting point for practice.",
            ],
            improvements=[
                "Add one concrete example to make the explanation easier to follow.",
                "Use a short pause between ideas instead of filling every gap.",
                "Practice the next transition until it feels natural.",
            ],
            examples=[
                "Try: The main idea is...",
                "Try: The reason this matters is...",
            ],
            next_practice=(
                "Record the same explanation once more and focus on smoother transitions."
            ),
        )

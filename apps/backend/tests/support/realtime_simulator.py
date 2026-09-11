from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from random import Random

import httpx

from suaraai.application.flow import StuckDetector, TalkMapMatcher
from suaraai.domain.copilot import FlowObservation, TalkMap
from suaraai.presentation.api.schemas import TalkMapPayload


@dataclass(frozen=True, slots=True)
class SimulationEvent:
    kind: str
    at_ms: int
    state: str
    detail: str | None = None
    status_code: int | None = None
    source: str | None = None


@dataclass(slots=True)
class RealtimeHintSimulator:
    """Drive the hint API with frontend-like final turns and timer ticks.

    The clock is virtual by default so tests remain fast and deterministic. Set
    ``real_time=True`` on ``speak`` or ``pause`` when reproducing a human-paced
    sequence locally.
    """

    client: httpx.AsyncClient
    session_id: str
    access_token: str
    talk_map: TalkMap
    seed: int = 7
    active_index: int = 0
    transcript: str = ""
    previous_hints: list[str] = field(default_factory=list)
    events: list[SimulationEvent] = field(default_factory=list)
    now_ms: int = 0
    _random: Random = field(init=False, repr=False)
    _detector: StuckDetector = field(init=False, repr=False)
    _matcher: TalkMapMatcher = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._random = Random(self.seed)
        self._detector = StuckDetector()
        self._matcher = TalkMapMatcher()

    @classmethod
    async def from_prepared_session(
        cls,
        client: httpx.AsyncClient,
        *,
        input_text: str = "Artificial Intelligence",
        seed: int = 7,
    ) -> RealtimeHintSimulator:
        response = await client.post(
            "/api/v1/session/prepare",
            json={"input_kind": "topic", "input_text": input_text},
        )
        assert response.status_code == 201, response.text
        payload = response.json()
        return cls(
            client=client,
            session_id=str(payload["session_id"]),
            access_token=str(payload["access_token"]),
            talk_map=TalkMapPayload.model_validate(payload["talk_map"]).to_domain(),
            seed=seed,
        )

    def next_word_delay_seconds(self) -> float:
        """Return a seeded human-like delay between 0.5 and 1.0 seconds."""

        return self._random.uniform(0.5, 1.0)

    def next_pause_seconds(self, *, stuck_probability: float = 0.25) -> float:
        """Sample either a normal pause or a PRD-sized stuck pause.

        A 0.5–1.0 second pause is not enough to enter STUCK under the PRD's
        more-than-3-second threshold, so the stuck branch intentionally samples
        3.1–4.0 seconds.
        """

        if self._random.random() < stuck_probability:
            return self._random.uniform(3.1, 4.0)
        return self._random.uniform(0.5, 1.0)

    async def speak(self, text: str, *, real_time: bool = False) -> None:
        for token in text.split():
            delay_seconds = self.next_word_delay_seconds()
            if real_time:
                await asyncio.sleep(delay_seconds)
            self.now_ms += round(delay_seconds * 1000)
            self.transcript = f"{self.transcript} {token}".strip()
            resumed = self._detector.state.value in {"HESITATING", "STUCK"}
            await self._observe(silence_ms=0, meaningful_speech_resumed=resumed)

    async def pause(self, seconds: float, *, real_time: bool = False, tick_ms: int = 250) -> None:
        if real_time:
            await asyncio.sleep(seconds)
        remaining_ms = round(seconds * 1000)
        elapsed_ms = 0
        previous_elapsed_ms = 0
        while elapsed_ms < remaining_ms:
            elapsed_ms = min(elapsed_ms + tick_ms, remaining_ms)
            self.now_ms += elapsed_ms - previous_elapsed_ms
            previous_elapsed_ms = elapsed_ms
            await self._observe(silence_ms=elapsed_ms)

    async def request_manual_hint(self) -> httpx.Response:
        return await self._request_hint(detail="manual")

    @property
    def hint_request_count(self) -> int:
        return sum(event.kind == "hint_response" for event in self.events)

    @property
    def states(self) -> list[str]:
        return [event.state for event in self.events if event.kind == "state"]

    async def _observe(
        self,
        *,
        silence_ms: int,
        meaningful_speech_resumed: bool = False,
    ) -> None:
        previous = self._detector.state
        progress = self._matcher.match(
            self.talk_map,
            self.transcript,
            self.active_index,
            set(),
        ).progress
        state = self._detector.observe(
            FlowObservation(
                silence_ms=silence_ms,
                filler_density=0.0,
                repetition_score=0.0,
                semantic_progress=progress,
                active_node_complete=False,
                meaningful_speech_resumed=meaningful_speech_resumed,
            ),
            self.now_ms,
        )
        self.events.append(SimulationEvent("state", self.now_ms, state.value))
        if state.value == "STUCK" and previous.value != "STUCK":
            await self._request_hint(detail="automatic")

    async def _request_hint(self, *, detail: str) -> httpx.Response:
        response = await self.client.post(
            f"/api/v1/session/{self.session_id}/hint",
            headers={"X-Session-Token": self.access_token},
            json={
                "active_index": self.active_index,
                "recent_transcript": self.transcript[-2400:],
                "covered_keywords": [],
                "previous_hints": self.previous_hints[-5:],
            },
        )
        payload = response.json()
        source = payload.get("source") if isinstance(payload, dict) else None
        if isinstance(payload, dict):
            hint_text = " ".join(
                str(payload.get(key) or "") for key in ("keyword", "starter", "next_idea")
            ).strip()
            if hint_text:
                self.previous_hints.append(hint_text)
        self.events.append(
            SimulationEvent(
                "hint_response",
                self.now_ms,
                self._detector.state.value,
                detail=detail,
                status_code=response.status_code,
                source=source if isinstance(source, str) else None,
            )
        )
        return response

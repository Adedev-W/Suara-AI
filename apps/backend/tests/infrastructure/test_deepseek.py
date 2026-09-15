from __future__ import annotations

import asyncio
import json

import httpx

from suaraai.domain.copilot import HintContext, InputKind
from suaraai.infrastructure.deterministic import DeterministicTalkMapGenerator
from suaraai.infrastructure.llm_gateway import DeepSeekLlm


def _completed_response(text: str) -> dict[str, object]:
    return {
        "status": "completed",
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


def test_talk_map_uses_deepseek_responses_json_schema() -> None:
    captured: list[httpx.Request] = []
    payload = {
        "title": "Artificial intelligence",
        "nodes": [
            {
                "title": "Definition",
                "intent": "Define AI",
                "keywords": ["AI"],
                "semantic_summary": "AI is machine intelligence.",
                "starter": "AI is machine intelligence.",
                "next_prompt": "Now consider an example.",
                "rescue_candidates": [],
            }
        ]
        * 3,
    }

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=_completed_response(json.dumps(payload)))

    async def run() -> None:
        generator = DeepSeekLlm(
            "test-key",
            "deepseek-flash",
            "https://api.deepseek.com",
            transport=httpx.MockTransport(handler),
        )
        talk_map = await generator.generate(InputKind.TOPIC, "Artificial intelligence")
        assert talk_map.title == "Artificial intelligence"
        assert len(talk_map.nodes) == 3

    asyncio.run(run())
    assert len(captured) == 1
    assert captured[0].url == "https://api.deepseek.com/responses"
    assert captured[0].headers["authorization"] == "Bearer test-key"
    body = json.loads(captured[0].content)
    assert body["model"] == "deepseek-flash"
    assert body["reasoning"] == {"effort": "none"}
    text = body["text"]
    assert isinstance(text, dict)
    output_format = text["format"]
    assert isinstance(output_format, dict)
    assert output_format["type"] == "json_schema"
    assert output_format["name"] == "talk_map"
    schema = output_format["schema"]
    assert isinstance(schema, dict)
    properties = schema["properties"]
    assert isinstance(properties, dict)
    nodes = properties["nodes"]
    assert isinstance(nodes, dict)
    assert nodes["maxItems"] == 7


def test_realtime_hint_buffers_stream_until_completed_json() -> None:
    captured: list[httpx.Request] = []
    continuation = (
        "Alan Turing asked whether a machine could show behavior that people would see as "
        "intelligent. His question mattered because it moved the discussion beyond simple "
        "calculations toward conversation, learning, and decisions. The Turing Test later "
        "gave researchers a practical way to discuss that idea."
    )
    hint_payload = {
        "level": 3,
        "keyword": "Turing Test",
        "starter": "Alan Turing asked a new question.",
        "next_idea": "The Turing Test made the question practical.",
        "continuation": continuation,
        "node_id": "node-1",
        "evidence": "Alan Turing asked whether a machine could think.",
    }
    response = _completed_response(json.dumps(hint_payload))
    events: list[dict[str, object]] = [
        {"type": "response.output_text.delta", "delta": "{"},
        {"type": "response.output_text.delta", "delta": '"level":3}'},
        {"type": "response.completed", "response": response},
    ]

    def encode_event(event: dict[str, object]) -> str:
        event_type = event["type"]
        assert isinstance(event_type, str)
        return f"event: {event_type}\ndata: {json.dumps(event)}"

    stream = "\n\n".join(encode_event(event) for event in events) + "\n\n"

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=stream.encode(),
        )

    async def run() -> None:
        talk_map = await DeterministicTalkMapGenerator().generate(InputKind.TOPIC, "AI history")
        generator = DeepSeekLlm(
            "test-key",
            "deepseek-flash",
            "https://api.deepseek.com",
            transport=httpx.MockTransport(handler),
        )
        hint = await generator.generate_hint(
            talk_map,
            0,
            "Alan Turing asked whether a machine could think.",
            [],
            [],
            HintContext("AI history", "Alan Turing asked whether a machine could think."),
        )
        assert hint.continuation == continuation
        assert hint.source == "ai"

    asyncio.run(run())
    body = json.loads(captured[0].content)
    assert body["stream"] is True
    assert body["reasoning"] == {"effort": "none"}
    text = body["text"]
    assert isinstance(text, dict)
    output_format = text["format"]
    assert isinstance(output_format, dict)
    assert output_format["name"] == "realtime_hint"

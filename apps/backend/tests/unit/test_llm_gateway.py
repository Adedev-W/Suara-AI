import asyncio
import json
from unittest.mock import patch

import httpx
import pytest

from suaraai.domain.copilot import InputKind, TalkMap, TalkMapNode
from suaraai.infrastructure.llm_gateway import AssemblyAILlmGateway, LlmGatewayError


class _FakeAsyncClient:
    def __init__(
        self, result: httpx.Response | Exception | list[httpx.Response | Exception]
    ) -> None:
        self._results = result if isinstance(result, list) else [result]
        self.request_kwargs: dict[str, object] = {}
        self.requests: list[dict[str, object]] = []

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def post(self, *_: object, **__: object) -> httpx.Response:
        self.request_kwargs = __
        self.requests.append(__)
        result = self._results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def _response(status_code: int, payload: object) -> httpx.Response:
    return httpx.Response(
        status_code=status_code,
        json=payload,
        request=httpx.Request("POST", "https://llm-gateway.assemblyai.com/v1/chat/completions"),
    )


def _gateway_error(result: httpx.Response | Exception) -> str:
    gateway = AssemblyAILlmGateway(
        api_key="test-key",
        model="gemini-2.5-flash-lite",
        base_url="https://llm-gateway.assemblyai.com/v1",
    )
    with (
        patch(
            "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
            return_value=_FakeAsyncClient(result),
        ),
        pytest.raises(LlmGatewayError) as error,
    ):
        asyncio.run(gateway._completion(system="system", user="user"))
    return str(error.value)


@pytest.mark.parametrize("status_code", [400, 401, 403, 429, 500])
def test_gateway_error_includes_provider_status_and_message(status_code: int) -> None:
    message = _gateway_error(
        _response(
            status_code,
            {
                "request_id": "req-123",
                "error": {"code": status_code, "message": "Invalid request"},
            },
        )
    )

    assert message == (
        f"LLM Gateway returned HTTP {status_code} (provider code {status_code}): "
        "Invalid request [request_id=req-123]"
    )


def test_structured_completion_uses_prompt_json_without_response_format() -> None:
    response = _response(
        200,
        {
            "choices": [
                {"message": {"content": ('```json\n{"title": "Bicycles", "nodes": []}\n```')}}
            ]
        },
    )
    fake_client = _FakeAsyncClient(response)
    gateway = AssemblyAILlmGateway(
        api_key="test-key",
        model="qwen3.5-4b-32k-fast",
        base_url="https://llm-gateway.assemblyai.com/v1",
    )

    with patch(
        "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
        return_value=fake_client,
    ):
        result = asyncio.run(
            gateway._structured_completion(
                system="Return a Talk Map.",
                user="Topic: bicycles",
                name="talk_map",
                schema={"type": "object", "required": ["title"]},
                parser=lambda payload: payload,
            )
        )

    request = fake_client.request_kwargs["json"]
    assert isinstance(request, dict)
    assert "response_format" not in request
    assert request["post_processing_steps"] == [{"type": "json-repair"}]
    system_message = request["messages"][0]["content"]
    assert "Return exactly one JSON object" in system_message
    assert 'top-level object MUST contain exactly these two keys: "title" and "nodes"' in (
        system_message
    )
    assert '"title": "Overall speaking plan title"' in system_message
    assert "<example_output>" in system_message
    assert result == {"title": "Bicycles", "nodes": []}


def test_structured_completion_extracts_json_after_prose() -> None:
    response = _response(
        200,
        {"choices": [{"message": {"content": 'Here is the JSON: {"title": "Bicycles"}'}}]},
    )
    gateway = AssemblyAILlmGateway(
        api_key="test-key",
        model="qwen3.5-4b-32k-fast",
        base_url="https://llm-gateway.assemblyai.com/v1",
    )

    with patch(
        "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
        return_value=_FakeAsyncClient(response),
    ):
        result = asyncio.run(
            gateway._structured_completion(
                system="Return JSON.",
                user="Topic: bicycles",
                name="talk_map",
                schema={"type": "object"},
                parser=lambda payload: payload,
            )
        )

    assert result == {"title": "Bicycles"}


def _valid_talk_map_payload() -> dict[str, object]:
    node = {
        "title": "What it is",
        "intent": "Explain the concept",
        "keywords": ["concept"],
        "semantic_summary": "A short explanation of the concept.",
        "starter": "The concept is...",
        "next_prompt": "Explain why it matters.",
    }
    return {"title": "Bicycles", "nodes": [node, dict(node), dict(node)]}


def test_generate_retries_after_invalid_structured_output() -> None:
    first_response = _response(
        200,
        {"choices": [{"message": {"content": '{"nodes": []}'}}]},
    )
    second_response = _response(
        200,
        {"choices": [{"message": {"content": json.dumps(_valid_talk_map_payload())}}]},
    )
    fake_client = _FakeAsyncClient([first_response, second_response])
    gateway = AssemblyAILlmGateway(
        api_key="test-key",
        model="qwen3.5-4b-32k-fast",
        base_url="https://llm-gateway.assemblyai.com/v1",
    )

    with patch(
        "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
        return_value=fake_client,
    ):
        result = asyncio.run(gateway.generate(InputKind.TOPIC, "bicycles"))

    assert result.title == "Bicycles"
    assert len(result.nodes) == 3
    assert len(fake_client.requests) == 2
    first_body = fake_client.requests[0]["json"]
    assert isinstance(first_body, dict)
    first_user = first_body["messages"][1]["content"]
    assert first_user == (
        "<input_kind>topic</input_kind>\n<input_material>\nbicycles\n</input_material>"
    )
    retry_body = fake_client.requests[1]["json"]
    assert isinstance(retry_body, dict)
    retry_system = retry_body["messages"][0]["content"]
    assert "field 'title' is missing" in retry_system
    assert "Generate the COMPLETE JSON object again" in retry_system
    assert '"title": "Overall speaking plan title"' in retry_system


def test_generate_keeps_title_required_in_schema() -> None:
    response = _response(
        200,
        {"choices": [{"message": {"content": json.dumps(_valid_talk_map_payload())}}]},
    )
    fake_client = _FakeAsyncClient(response)
    gateway = AssemblyAILlmGateway(
        api_key="test-key",
        model="qwen3.5-4b-32k-fast",
        base_url="https://llm-gateway.assemblyai.com/v1",
    )

    with patch(
        "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
        return_value=fake_client,
    ):
        asyncio.run(gateway.generate(InputKind.TOPIC, "bicycles"))

    request = fake_client.request_kwargs["json"]
    assert isinstance(request, dict)
    system_message = request["messages"][0]["content"]
    assert '"title"' in system_message
    assert '"required": ["title", "nodes"]' in system_message


def test_generate_fails_after_two_invalid_structured_outputs() -> None:
    fake_client = _FakeAsyncClient(
        [
            _response(200, {"choices": [{"message": {"content": '{"nodes": []}'}}]}),
            _response(200, {"choices": [{"message": {"content": '{"nodes": []}'}}]}),
        ]
    )
    gateway = AssemblyAILlmGateway(
        api_key="test-key",
        model="qwen3.5-4b-32k-fast",
        base_url="https://llm-gateway.assemblyai.com/v1",
    )

    with (
        patch(
            "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
            return_value=fake_client,
        ),
        pytest.raises(LlmGatewayError) as error,
    ):
        asyncio.run(gateway.generate(InputKind.TOPIC, "bicycles"))

    assert str(error.value) == "LLM Gateway field 'title' is missing after 2 attempts"
    assert 'model_output={"nodes": []}' in error.value.diagnostic_message
    assert len(fake_client.requests) == 2


def test_generate_hint_uses_bounded_context_and_parses_ai_response() -> None:
    response = _response(
        200,
        {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "level": 2,
                                "keyword": "example",
                                "starter": "For example, ...",
                                "next_idea": "Describe one real use case.",
                            }
                        )
                    }
                }
            ]
        },
    )
    fake_client = _FakeAsyncClient(response)
    gateway = AssemblyAILlmGateway(
        api_key="test-key",
        model="qwen3.5-4b-32k-fast",
        base_url="https://llm-gateway.assemblyai.com/v1",
    )
    talk_map = TalkMap(
        title="Artificial intelligence",
        nodes=[
            TalkMapNode(
                id="one",
                title="Definition",
                intent="Define AI",
                keywords=["artificial intelligence", "example"],
                semantic_summary="Explain the idea.",
                starter="Artificial intelligence is...",
                next_prompt="Give an example.",
            )
        ],
    )

    with patch(
        "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
        return_value=fake_client,
    ):
        result = asyncio.run(
            gateway.generate_hint(
                talk_map,
                0,
                "It refers to machines performing human-like tasks.",
                ["artificial intelligence"],
                ["Artificial intelligence is... Give an example."],
            )
        )

    assert result.level == 2
    assert result.source == "ai"
    request = fake_client.request_kwargs["json"]
    assert isinstance(request, dict)
    assert request["max_tokens"] == 320
    assert request["post_processing_steps"] == [{"type": "json-repair"}]
    user_message = request["messages"][1]["content"]
    assert "It refers to machines performing human-like tasks." in user_message
    assert "Artificial intelligence is... Give an example." in user_message


def test_gateway_error_keeps_full_provider_response_for_diagnostics() -> None:
    provider_message = "Invalid response_format: " + ("details " * 100)
    response = _response(
        400,
        {
            "request_id": "req-long",
            "error": {
                "code": 400,
                "message": provider_message,
                "param": "response_format",
                "type": "invalid_request_error",
                "token": "do-not-log-this",
            },
        },
    )
    gateway = AssemblyAILlmGateway(
        api_key="test-key",
        model="gemini-2.5-flash-lite",
        base_url="https://llm-gateway.assemblyai.com/v1",
    )

    with (
        patch(
            "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
            return_value=_FakeAsyncClient(response),
        ),
        pytest.raises(LlmGatewayError) as error,
    ):
        asyncio.run(gateway._completion(system="system", user="user"))

    assert len(str(error.value)) < len(error.value.diagnostic_message)
    assert '"details details details' not in str(error.value)
    assert error.value.diagnostic_message.startswith(
        "LLM Gateway returned HTTP 400 (provider code 400): "
    )
    assert " ".join(provider_message.split()) in error.value.diagnostic_message
    assert '"param": "response_format"' in error.value.diagnostic_message
    assert '"type": "invalid_request_error"' in error.value.diagnostic_message
    assert '"token": "[redacted]"' in error.value.diagnostic_message


def test_gateway_error_distinguishes_timeout() -> None:
    message = _gateway_error(httpx.TimeoutException("upstream timed out"))

    assert message == "LLM Gateway request timed out after 30 seconds"


def test_gateway_error_reports_non_json_success_response() -> None:
    response = httpx.Response(
        status_code=200,
        content=b"not-json",
        request=httpx.Request("POST", "https://llm-gateway.assemblyai.com/v1/chat/completions"),
    )

    assert _gateway_error(response) == "LLM Gateway returned a non-JSON success response"


def test_gateway_error_reports_missing_completion_and_request_id() -> None:
    response = _response(200, {"request_id": "req-456", "choices": []})

    assert _gateway_error(response) == ("LLM Gateway returned no completion [request_id=req-456]")

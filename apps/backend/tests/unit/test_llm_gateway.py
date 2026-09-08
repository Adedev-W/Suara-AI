import asyncio
from unittest.mock import patch

import httpx
import pytest

from suaraai.infrastructure.llm_gateway import AssemblyAILlmGateway, LlmGatewayError


class _FakeAsyncClient:
    def __init__(self, result: httpx.Response | Exception) -> None:
        self._result = result

    async def __aenter__(self) -> _FakeAsyncClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def post(self, *_: object, **__: object) -> httpx.Response:
        if isinstance(self._result, Exception):
            raise self._result
        return self._result


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
    with patch(
        "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
        return_value=_FakeAsyncClient(result),
    ), pytest.raises(LlmGatewayError) as error:
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

    with patch(
        "suaraai.infrastructure.llm_gateway.httpx.AsyncClient",
        return_value=_FakeAsyncClient(response),
    ), pytest.raises(LlmGatewayError) as error:
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

    assert _gateway_error(response) == (
        "LLM Gateway returned no completion [request_id=req-456]"
    )

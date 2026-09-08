from __future__ import annotations

import json
import re
from collections.abc import Sequence
from typing import cast

import httpx

from suaraai.domain.copilot import Feedback, InputKind, RetrievedChunk, TalkMap, TalkMapNode


class LlmGatewayError(RuntimeError):
    def __init__(self, message: str, *, diagnostic_message: str | None = None) -> None:
        super().__init__(message)
        self.diagnostic_message = diagnostic_message or message


_MAX_PROVIDER_ERROR_LENGTH = 400
_SENSITIVE_ERROR_KEYS = frozenset(
    {"authorization", "api_key", "api-key", "token", "secret", "password"}
)
_SENSITIVE_ERROR_PATTERN = re.compile(
    r"(?i)\b(authorization|api[_ -]?key|token|secret|password)\b\s*[:=]\s*\S+"
)


class AssemblyAILlmGateway:
    def __init__(
        self,
        api_key: str | None,
        model: str,
        base_url: str,
        fallback_model: str | None = None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._base_url = base_url.rstrip("/")
        self._fallback_model = fallback_model
        self._timeout = timeout_seconds

    async def generate(self, input_kind: InputKind, input_text: str) -> TalkMap:
        payload = await self._structured_completion(
            system=(
                "You create a lightweight Talk Map for an English speaking practice session. "
                "Return 3 to 7 nodes. Describe concepts rather than a script. Keep titles "
                "short, sentence starters generic, and next prompts concise."
            ),
            user=f"Input kind: {input_kind.value}\nMaterial:\n{input_text}",
            name="talk_map",
            schema=TALK_MAP_SCHEMA,
        )
        return _parse_talk_map(payload)

    async def generate_feedback(self, transcript: str, talk_map: TalkMap) -> Feedback:
        payload = await self._structured_completion(
            system=(
                "You are a kind, practical English speaking coach. Review the user's spoken "
                "English after a recording. Do not score accent or shame grammar. Give concise, "
                "actionable feedback for a beginner or intermediate speaker."
            ),
            user=(
                f"Talk Map: {json.dumps(_talk_map_to_dict(talk_map))}\n"
                f"Final transcript:\n{transcript}"
            ),
            name="speaking_feedback",
            schema=FEEDBACK_SCHEMA,
        )
        return Feedback(
            summary=_required_string(payload, "summary"),
            strengths=_required_string_list(payload, "strengths"),
            improvements=_required_string_list(payload, "improvements"),
            examples=_required_string_list(payload, "examples"),
            next_practice=_required_string(payload, "next_practice"),
        )

    async def answer(self, question: str, context: Sequence[RetrievedChunk]) -> str:
        if not context:
            return "I could not find enough information in your session materials to answer that."
        joined_context = "\n\n".join(
            f"[{item.source_name}, page {item.page_number or 'unknown'}]\n{item.text}"
            for item in context
        )
        result = await self._completion(
            system=(
                "Answer only from the supplied session materials. If the materials do not "
                "support an answer, say so. Keep the answer concise and include source names "
                "and page numbers when available."
            ),
            user=f"Question: {question}\n\nSession materials:\n{joined_context}",
        )
        return result

    async def _structured_completion(
        self, system: str, user: str, name: str, schema: dict[str, object]
    ) -> dict[str, object]:
        content = await self._completion(
            system=system,
            user=user,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": name, "schema": schema, "strict": True},
            },
        )
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise LlmGatewayError("LLM Gateway returned invalid JSON") from exc
        if not isinstance(parsed, dict):
            raise LlmGatewayError("LLM Gateway returned an invalid object")
        return cast(dict[str, object], parsed)

    async def _completion(
        self,
        system: str,
        user: str,
        response_format: dict[str, object] | None = None,
    ) -> str:
        if not self._api_key:
            raise LlmGatewayError("LLM Gateway is not configured")
        body: dict[str, object] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": 1400,
        }
        if self._fallback_model:
            body["fallbacks"] = [{"model": self._fallback_model}]
        if response_format is not None:
            body["response_format"] = response_format
            body["post_processing_steps"] = [{"type": "json-repair"}]
        headers = {"authorization": self._api_key, "content-type": "application/json"}
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.post(
                    f"{self._base_url}/chat/completions", headers=headers, json=body
                )
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise LlmGatewayError(
                f"LLM Gateway request timed out after {self._timeout:g} seconds"
            ) from exc
        except httpx.HTTPStatusError as exc:
            public_message, diagnostic_message = _format_provider_http_error(exc.response)
            raise LlmGatewayError(
                public_message, diagnostic_message=diagnostic_message
            ) from exc
        except httpx.RequestError as exc:
            raise LlmGatewayError(
                f"LLM Gateway network error ({type(exc).__name__})"
            ) from exc
        except httpx.HTTPError as exc:
            raise LlmGatewayError(
                f"LLM Gateway HTTP client error ({type(exc).__name__})"
            ) from exc
        try:
            data = response.json()
        except ValueError as exc:
            raise LlmGatewayError("LLM Gateway returned a non-JSON success response") from exc
        if not isinstance(data, dict):
            raise LlmGatewayError("LLM Gateway returned an invalid response")
        choices = data.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise LlmGatewayError(
                _with_request_id("LLM Gateway returned no completion", _request_id(data))
            )
        message = choices[0].get("message")
        if not isinstance(message, dict):
            raise LlmGatewayError(
                _with_request_id(
                    "LLM Gateway completion has no message", _request_id(data)
                )
            )
        content = message.get("content")
        if not isinstance(content, str):
            raise LlmGatewayError(
                _with_request_id(
                    "LLM Gateway completion has no text content", _request_id(data)
                )
            )
        return content


TALK_MAP_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "nodes": {
            "type": "array",
            "minItems": 3,
            "maxItems": 7,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "intent": {"type": "string"},
                    "keywords": {
                        "type": "array",
                        "minItems": 1,
                        "items": {"type": "string"},
                    },
                    "semantic_summary": {"type": "string"},
                    "starter": {"type": "string"},
                    "next_prompt": {"type": "string"},
                },
                "required": [
                    "title",
                    "intent",
                    "keywords",
                    "semantic_summary",
                    "starter",
                    "next_prompt",
                ],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "nodes"],
    "additionalProperties": False,
}

FEEDBACK_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "strengths": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        "improvements": {
            "type": "array",
            "minItems": 1,
            "items": {"type": "string"},
        },
        "examples": {"type": "array", "minItems": 1, "items": {"type": "string"}},
        "next_practice": {"type": "string"},
    },
    "required": ["summary", "strengths", "improvements", "examples", "next_practice"],
    "additionalProperties": False,
}


def _format_provider_http_error(response: httpx.Response) -> tuple[str, str]:
    provider_code: str | None = None
    provider_message: str | None = None
    request_id: str | None = None
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        request_id = _request_id(payload)
        raw_error = payload.get("error")
        if isinstance(raw_error, dict):
            provider_code = _error_code(raw_error.get("code"))
            raw_message = raw_error.get("message")
            if isinstance(raw_message, str) and raw_message.strip():
                provider_message = _sanitize_provider_message(raw_message)

    detail = f"LLM Gateway returned HTTP {response.status_code}"
    if provider_code is not None:
        detail += f" (provider code {provider_code})"
    if provider_message is not None:
        detail += f": {provider_message}"
    if request_id is not None:
        detail += f" [request_id={request_id}]"

    if isinstance(payload, dict):
        provider_details = json.dumps(
            _redact_provider_payload(payload), ensure_ascii=False, sort_keys=True
        )
    else:
        provider_details = _sanitize_provider_message(response.text, max_length=None)
    diagnostic_detail = (
        f"{detail} [provider_response="
        f"{provider_details}]"
    )
    return detail, diagnostic_detail


def _request_id(payload: dict[str, object]) -> str | None:
    value = payload.get("request_id")
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _error_code(value: object) -> str | None:
    if isinstance(value, (int, str)) and not isinstance(value, bool):
        return str(value)
    return None


def _sanitize_provider_message(
    value: str, *, max_length: int | None = _MAX_PROVIDER_ERROR_LENGTH
) -> str:
    normalized = " ".join(value.split())
    redacted = _SENSITIVE_ERROR_PATTERN.sub(r"\1=[redacted]", normalized)
    if max_length is None:
        return redacted
    return redacted[:max_length]


def _redact_provider_payload(value: object) -> object:
    if isinstance(value, dict):
        redacted: dict[object, object] = {}
        for key, item in value.items():
            normalized_key = (
                re.sub(r"[\s-]+", "_", key.lower()) if isinstance(key, str) else ""
            )
            redacted[key] = (
                "[redacted]"
                if normalized_key in _SENSITIVE_ERROR_KEYS
                else _redact_provider_payload(item)
            )
        return redacted
    if isinstance(value, list):
        return [_redact_provider_payload(item) for item in value]
    if isinstance(value, str):
        return _sanitize_provider_message(value, max_length=None)
    return value


def _with_request_id(message: str, request_id: str | None) -> str:
    if request_id is None:
        return message
    return f"{message} [request_id={request_id}]"


def _parse_talk_map(payload: dict[str, object]) -> TalkMap:
    title = _required_string(payload, "title")
    raw_nodes = payload.get("nodes")
    if not isinstance(raw_nodes, list) or not 3 <= len(raw_nodes) <= 7:
        raise LlmGatewayError("Generated Talk Map must contain between 3 and 7 nodes")
    nodes: list[TalkMapNode] = []
    for index, raw_node in enumerate(raw_nodes):
        if not isinstance(raw_node, dict):
            raise LlmGatewayError("Generated Talk Map contains an invalid node")
        nodes.append(
            TalkMapNode(
                id=f"node-{index + 1}",
                title=_required_string(raw_node, "title"),
                intent=_required_string(raw_node, "intent"),
                keywords=_required_string_list(raw_node, "keywords"),
                semantic_summary=_required_string(raw_node, "semantic_summary"),
                starter=_required_string(raw_node, "starter"),
                next_prompt=_required_string(raw_node, "next_prompt"),
            )
        )
    return TalkMap(title=title, nodes=nodes)


def _talk_map_to_dict(talk_map: TalkMap) -> dict[str, object]:
    return {
        "title": talk_map.title,
        "nodes": [
            {
                "title": node.title,
                "intent": node.intent,
                "keywords": node.keywords,
                "semantic_summary": node.semantic_summary,
                "starter": node.starter,
                "next_prompt": node.next_prompt,
            }
            for node in talk_map.nodes
        ],
    }


def _required_string(data: dict[str, object], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise LlmGatewayError(f"LLM Gateway field {key!r} is missing")
    return value.strip()


def _string_list(data: dict[str, object], key: str) -> list[str]:
    value = data.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise LlmGatewayError(f"LLM Gateway field {key!r} is invalid")
    return [item.strip() for item in value if item.strip()]


def _required_string_list(data: dict[str, object], key: str) -> list[str]:
    values = _string_list(data, key)
    if not values:
        raise LlmGatewayError(f"LLM Gateway field {key!r} must contain text")
    return values

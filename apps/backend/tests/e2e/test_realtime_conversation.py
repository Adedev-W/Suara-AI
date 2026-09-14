from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest

API_PREFIX = "/api/v1"
HEALTH_TIMEOUT_SECONDS = 20.0
SCENARIO_TIMEOUT_SECONDS = 90.0
REQUEST_TIMEOUT = httpx.Timeout(60.0, connect=5.0)


@contextmanager
def running_backend() -> Iterator[tuple[subprocess.Popen[bytes], str]]:
    """Start the real ASGI application and expose its local HTTP address."""

    backend_directory = Path(__file__).resolve().parents[2]
    repository_root = backend_directory.parents[1]
    port = _free_port()
    command = [
        sys.executable,
        "-m",
        "uvicorn",
        "suaraai.main:app",
        "--app-dir",
        "src",
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
    ]
    env_file = repository_root / ".env"
    if env_file.is_file():
        # Let Uvicorn load the same application configuration used for local development.
        command.extend(("--env-file", str(env_file)))
    process = subprocess.Popen(
        command,
        cwd=backend_directory,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    base_url = f"http://127.0.0.1:{port}"
    try:
        yield process, base_url
    finally:
        # Terminate the child even when an assertion or provider timeout fails.
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def _free_port() -> int:
    """Ask the operating system for an available local TCP port."""

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as socket_handle:
        socket_handle.bind(("127.0.0.1", 0))
        return int(socket_handle.getsockname()[1])


async def _wait_for_health(
    client: httpx.AsyncClient,
    process: subprocess.Popen[bytes],
) -> None:
    """Wait until the real server accepts requests or fail with a useful cause."""

    deadline = time.monotonic() + HEALTH_TIMEOUT_SECONDS
    last_error = "the server did not return a response"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"Backend exited before becoming ready: code {process.returncode}")
        try:
            response = await client.get(f"{API_PREFIX}/health")
            if response.status_code == 200:
                _log("API", f"GET {API_PREFIX}/health -> {response.status_code}")
                return
            last_error = f"HTTP {response.status_code}: {response.text}"
        except httpx.HTTPError as error:
            last_error = f"{type(error).__name__}: {error}"
        await asyncio.sleep(0.2)
    raise AssertionError(f"Backend health check timed out: {last_error}")


async def _post_hint(
    client: httpx.AsyncClient,
    session_id: str,
    access_token: str,
    transcript: str,
    previous_hints: list[str],
) -> dict[str, Any]:
    """Call the public hint endpoint exactly as the frontend does."""

    response = await client.post(
        f"{API_PREFIX}/session/{session_id}/hint",
        headers={"X-Session-Token": access_token},
        json={
            "active_index": 0,
            "recent_transcript": transcript[-2400:],
            "covered_keywords": [],
            "previous_hints": previous_hints[-5:],
        },
    )
    payload = _json_object(response)
    _log(
        "API",
        f"POST {API_PREFIX}/session/{{session_id}}/hint -> "
        f"{response.status_code} {json.dumps(payload, ensure_ascii=False)}",
    )
    assert response.status_code == 200, response.text
    return payload


def _json_object(response: httpx.Response) -> dict[str, Any]:
    """Decode an object response so failures show the actual server payload."""

    payload = response.json()
    assert isinstance(payload, dict), response.text
    return payload


def _require_text(payload: dict[str, Any], field: str) -> str:
    """Require a non-empty string without depending on backend Python models."""

    value = payload.get(field)
    assert isinstance(value, str) and value.strip(), payload
    return value


def _log(label: str, message: str) -> None:
    """Print the conversation timeline when pytest runs with ``-s``."""

    print(f"[{label}] {message}", flush=True)


async def _run_conversation() -> None:
    """Drive a human-paced text conversation through the public REST API."""

    with running_backend() as (process, base_url):
        async with httpx.AsyncClient(base_url=base_url, timeout=REQUEST_TIMEOUT) as client:
            await _wait_for_health(client, process)

            _log("USER", "Preparing a session about Artificial Intelligence")
            prepared_response = await client.post(
                f"{API_PREFIX}/session/prepare",
                json={
                    "input_kind": "topic",
                    "input_text": "Artificial Intelligence",
                },
            )
            prepared = _json_object(prepared_response)
            assert prepared_response.status_code == 201, prepared_response.text
            session_id = _require_text(prepared, "session_id")
            access_token = _require_text(prepared, "access_token")
            talk_map = prepared.get("talk_map")
            assert isinstance(talk_map, dict), prepared
            nodes = talk_map.get("nodes")
            assert isinstance(nodes, list) and 3 <= len(nodes) <= 7, prepared
            _log("API", f"POST {API_PREFIX}/session/prepare -> 201")
            _log("SYSTEM", f"Talk Map: {json.dumps(talk_map, ensure_ascii=False)}")

            transcript = ""
            previous_hints: list[str] = []

            # Short pauses represent normal speaking and must not create a rescue request.
            for text, pause_seconds in (
                (
                    "Artificial intelligence is a way for computers to perform tasks "
                    "that usually need human reasoning.",
                    1.0,
                ),
                (
                    "It can learn patterns from data and help people make decisions.",
                    1.0,
                ),
            ):
                transcript = f"{transcript} {text}".strip()
                _log("USER", text)
                _log("PAUSE", f"{pause_seconds:.1f} seconds; no hint request")
                await asyncio.sleep(pause_seconds)

            # The backend has no silence detector; this delay models the frontend deciding
            # that the speaker is stuck before it calls the REST hint endpoint.
            stuck_pause_seconds = 1.6
            _log("USER", "... blank ...")
            _log("PAUSE", f"{stuck_pause_seconds:.1f} seconds; simulator marks STUCK")
            await asyncio.sleep(stuck_pause_seconds)

            hint = await _post_hint(
                client,
                session_id,
                access_token,
                transcript,
                previous_hints,
            )
            assert hint.get("source") == "ai", hint
            assert hint.get("level") in {2, 3}, hint
            keyword = _require_text(hint, "keyword")
            starter = _require_text(hint, "starter")
            next_idea = _require_text(hint, "next_idea")
            previous_hints.append(" ".join((keyword, starter, next_idea)))
            _log("SYSTEM", f"Hint shown: {starter} / {next_idea}")

            # Resuming speech ends the simulated stuck episode immediately.
            recovery_text = (
                "A practical example is a recommendation system suggesting useful content."
            )
            transcript = f"{transcript} {recovery_text}".strip()
            _log("USER", recovery_text)
            _log("PAUSE", "0.8 seconds; speaking has resumed")
            await asyncio.sleep(0.8)

            # A new pause is a new rescue episode; there is no post-recovery cooldown.
            _log("USER", "... blank again ...")
            _log("PAUSE", f"{stuck_pause_seconds:.1f} seconds; new STUCK episode")
            await asyncio.sleep(stuck_pause_seconds)
            next_hint = await _post_hint(
                client,
                session_id,
                access_token,
                transcript,
                previous_hints,
            )
            assert next_hint.get("source") == "ai", next_hint
            assert _require_text(next_hint, "starter")
            assert _require_text(next_hint, "next_idea")


def test_realtime_conversation_uses_the_live_rest_api() -> None:
    """Verify a timed text conversation through a real server and real LLM provider."""

    # Keep normal local checks fast and quota-free unless the caller opts in explicitly.
    if os.getenv("SUARAAI_RUN_LIVE_LLM_TESTS") != "1":
        pytest.skip("Set SUARAAI_RUN_LIVE_LLM_TESTS=1 to run the real provider conversation")
    asyncio.run(asyncio.wait_for(_run_conversation(), timeout=SCENARIO_TIMEOUT_SECONDS))

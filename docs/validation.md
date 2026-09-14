# PRD validation checklist

## Automated checks

Run from the repository root:

```bash
make lint
make format-check
make typecheck
make test
make build
```

Focused backend tests cover bounded Talk Maps for long input, invalid active
nodes, contextual hint inputs, and deterministic fallback when the provider is
unavailable. The opt-in end-to-end conversation scenario starts the real ASGI
server as a separate process, uses HTTPX to call the public REST endpoints,
sends real text turns, waits in real time, and calls the configured AssemblyAI
LLM Gateway. It prints the conversation timeline and returned data for
inspection with `-s`.

Run the live conversation from `apps/backend`:

```bash
SUARAAI_RUN_LIVE_LLM_TESTS=1 .venv/bin/pytest \
  tests/e2e/test_realtime_conversation.py -s -vv
```

The test requires `ASSEMBLYAI_API_KEY` in the shell environment or repository
`.env` and consumes provider quota. Without the explicit
`SUARAAI_RUN_LIVE_LLM_TESTS=1` flag, the scenario is skipped. The backend test
uses REST because the current backend exposes REST hint endpoints; AssemblyAI
streaming WebSocket and browser media capture are separate frontend/provider
paths and are not simulated by this text scenario.

The frontend `test` command remains a TypeScript compilation smoke check because
no runtime browser test dependency is currently installed.

## Manual acceptance

1. Open the setup screen, choose Topic, Notes, or Key points, and submit text.
2. Confirm the Talk Map contains 3–7 concise nodes and that moving a node is
   saved before camera readiness.
3. Allow camera and microphone access. Confirm the preview is mirrored in the
   readiness and recording screens.
4. Start recording. Confirm the timer and listening status update in real time,
   and a final transcript turn updates the Talk Map.
5. Stay silent for more than 1.5 seconds before first speaking and confirm no
   automatic hint appears. Speak, pause for 1.4 seconds, and confirm no hint;
   continue the pause beyond 1.5 seconds and confirm a Talk Map fallback appears
   immediately without repeated network requests.
6. Press Hint manually and confirm a cue appears without exposing a full script.
   When an LLM key is configured, confirm a contextual cue can replace the
   deterministic fallback. Resume before the response and confirm the old hint
   fades and never returns. Pause again and confirm a new episode works without
   a cooldown. When STT is unavailable, confirm local guidance and recording
   continue.
7. Stop recording, play the local preview, and download the WebM recording.
8. Request feedback and confirm the result includes strengths, improvements,
   useful phrases, and a concrete next practice.
9. Upload a text-bearing PDF or PPTX, ask a question about it, and confirm the
   answer includes retrieved source metadata. Uploading an unsupported type or
   unreadable document should return a controlled error.
10. Open browser developer tools and confirm the long-lived AssemblyAI key is
    absent from frontend requests and storage.

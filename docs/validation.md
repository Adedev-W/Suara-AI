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

Backend tests cover health behavior, Talk Map matching, hesitation/stuck and
recovery transitions, document chunk metadata, anonymous session preparation,
feedback completion, invalid token rejection, and missing STT configuration.
They also include an async realtime hint simulator. It feeds final words with
seeded 0.5–1.0 second inter-word delays, advances a virtual timer in 250 ms
ticks, and verifies one rescue request per stuck episode with both successful
and failing fake providers. A 0.5–1.0 second pause is intentionally tested as a
normal pause; the PRD's more-than-3-second threshold is used for a stuck case.
The simulator uses an in-process ASGI transport and never calls the provider.
The frontend `test` command is a TypeScript compilation smoke check because no
runtime browser test dependency is currently installed.

Run the focused simulation from `apps/backend`:

```bash
.venv/bin/pytest tests/integration/test_realtime_hint_simulation.py
```

The live provider smoke test is opt-in because it consumes provider quota. It
loads `ASSEMBLYAI_API_KEY` through `load_settings()` from the repository `.env`
without printing the key:

```bash
SUARAAI_RUN_LIVE_LLM_TESTS=1 .venv/bin/pytest \
  tests/integration/test_live_realtime_hint.py -s
```

The live test uses a deterministic session preparation step and sends one real
hint request. It passes only when the response has `source="ai"`; a provider
failure is reported by the test response/log instead of being mistaken for a
successful live integration.

## Manual acceptance

1. Open the setup screen, choose Topic, Notes, or Key points, and submit text.
2. Confirm the Talk Map contains 3–7 concise nodes and that moving a node is
   saved before camera readiness.
3. Allow camera and microphone access. Confirm the preview is mirrored in the
   readiness and recording screens.
4. Start recording. Confirm the timer advances in real time, the partial
   transcript appears, and a final turn updates the transcript and Talk Map.
5. Pause for at least 1.8 seconds to observe hesitation behavior, then pause
   beyond 3 seconds to observe a stronger cue. Keep waiting without speaking
   and confirm the cue does not flicker or trigger repeated network requests.
   Resume speaking and confirm the recovered message and cooldown behavior.
6. Press Hint manually and confirm a cue appears without exposing a full script.
   When an LLM key is configured, confirm a contextual cue can replace the
   deterministic fallback; when it is unavailable, confirm the fallback remains
   visible and recording continues.
7. Stop recording, play the local preview, and download the WebM recording.
8. Request feedback and confirm the result includes strengths, improvements,
   useful phrases, and a concrete next practice.
9. Upload a text-bearing PDF or PPTX, ask a question about it, and confirm the
   answer includes retrieved source metadata. Uploading an unsupported type or
   unreadable document should return a controlled error.
10. Open browser developer tools and confirm the long-lived AssemblyAI key is
    absent from frontend requests and storage.

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
sends real text turns, waits in real time, and calls the configured DeepSeek
Responses API. It prints the conversation timeline and returned data for
inspection with `-s`.

Run the live conversation from `apps/backend`:

```bash
SUARAAI_RUN_LIVE_LLM_TESTS=1 .venv/bin/pytest \
  tests/e2e/test_realtime_conversation.py -s -vv
```

The test requires `DEEPSEEK_API_KEY` in the shell environment or repository
`.env` and consumes provider quota. Without the explicit
`SUARAAI_RUN_LIVE_LLM_TESTS=1` flag, the scenario is skipped. The backend test
uses REST because the current backend exposes REST hint endpoints; AssemblyAI
streaming WebSocket and browser media capture are separate frontend/provider
paths and are not simulated by this text scenario.

The frontend `test` command runs behavioral tests using Node 24+ and its built-in
TypeScript stripping, in one process so individual cases appear in the report.
No runtime test dependency is required. Tests exercise
the transcript reducer, streaming parser, sample-based pause detector, and
assistant controller with injected clocks and deferred provider responses.
Type checking is separate. These tests do not exercise microphone hardware or
browser layout.

## Manual acceptance

1. Open the setup screen, choose Topic, Notes, or Key points, and submit text.
2. Confirm the Talk Map contains 3–7 concise nodes and that moving a node is
   saved before camera readiness.
3. Allow camera and microphone access. Confirm the preview is mirrored in the
   readiness and recording screens.
4. Start recording. Confirm the timer and listening status update in real time.
   Speak a sentence and confirm partial words appear in the Live transcript
   panel while you speak, then settle into the final transcript when the turn
   completes. Confirm partial text already informs hints, and permanent Talk
   Map position changes require an AI suggestion backed by final speech.
5. Stay silent for more than 1.5 seconds before first speaking and confirm no
   automatic hint appears. Speak, pause for 1.4 seconds, and confirm no hint;
   continue an unfinished phrase's pause beyond 1.5 seconds and confirm a cached
   AI or local candidate appears. After a complete sentence, confirm the delay
   is 2.5 seconds. Repeat with quiet speech, short clicks and background noise;
   noise without new recognized speech must not generate repeated blank events.
6. Press Hint and confirm a readable continuation appears. AI-generated hints
   and prepared candidates should contain 40–70 words. Confirm a fallback can
   be replaced once within two seconds; then it stays stable. Resume speaking
   and read along: the card must remain visible, and late AI responses must not
   change its text. Dismiss the card and verify the next genuine blank can show
   guidance. With STT disconnected, confirm recording and local 2.5-second
   pause guidance continue. Legacy maps may retain short fallback prompts.
7. Stop recording, play the local preview, and download the WebM recording.
   Open View conversation log and confirm a vertical timeline contains each
   finalized utterance, every automatic blank with pause/detection times, and
   the deterministic hint plus any accepted AI replacement. Confirm the close
   button and Escape return to Preview, and Copy log places the same formatted
   timeline on the clipboard. Confirm speech timestamps differ from transcript
   arrival timestamps. Expand diagnostics to inspect provider latency, fallback,
   timeout and stale-response decisions. Manual displays are not automatic hint
   entries; their request diagnostics can still appear.
8. Choose Record again and confirm the previous conversation log is cleared.
9. Request feedback and confirm the result includes strengths, improvements,
   useful phrases, and a concrete next practice.
10. Upload a text-bearing PDF or PPTX, ask a question about it, and confirm the
   answer includes retrieved source metadata. Uploading an unsupported type or
   unreadable document should return a controlled error.
11. Open browser developer tools and confirm the long-lived AssemblyAI key is
    absent from frontend requests and storage.
12. Replay the reported AI-topic example. After the user defines AI, the next
    suggestion should explain a use or example instead of asking for the same
    definition. Delay final transcripts and AI responses independently to test
    stale-context rejection. Prefetch should remain limited to one request in
    flight and one dispatch per three seconds.
13. Measure at least 20 local/cache displays in an active tab. Target p95 under
    100 ms from blank confirmation to visible card; log dispatch timing and
    inspect browser paint timing separately. Do not count network generation
    time as local display latency or claim this target from unit tests alone.

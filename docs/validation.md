# Validation

Use this document to decide whether a change is ready for a demo. Run commands
from the repository root.

## Automated checks

The complete local check is:

```bash
make check
```

It runs backend and frontend linting, formatting checks, type checks, tests, and
builds. The frontend uses Node 24's built-in test runner; it does not yet have
a browser test runner.

The live backend conversation test is opt-in because it calls DeepSeek and
consumes provider quota:

```bash
SUARAAI_RUN_LIVE_LLM_TESTS=1 make test-backend
```

Without that flag, the test is skipped. It exercises the public REST flow, not
microphone hardware or the AssemblyAI WebSocket.

## Product acceptance flow

1. Open the setup screen and submit a topic, notes, or key points.
2. Confirm that the Talk Map contains 3–7 concise nodes.
3. Reorder a node and confirm the change is saved before camera readiness.
4. Grant camera and microphone permission. Confirm the preview is mirrored.
5. Start recording and confirm the timer, listening state, partial transcript,
   and finalized transcript update.
6. Speak, pause for less than 1.5 seconds, and confirm no automatic hint appears.
7. Continue the pause beyond 1.5 seconds and confirm a cached or deterministic
   hint appears.
8. Press Hint manually and confirm a readable continuation appears.
9. Resume speaking and confirm a late response cannot replace a current card.
10. Stop recording and verify local playback, WebM download, and the timeline.
11. Open the conversation log and verify speech, transcript, blank, hint, and
    diagnostic entries are present and copyable.
12. Request feedback and confirm strengths, improvements, useful phrases, and a
    next practice are shown.
13. Upload a text-bearing PDF or PPTX and ask a question about it.
14. Confirm the answer includes source metadata when material context is found.
15. Open browser developer tools and confirm the long-lived AssemblyAI key is
    never sent to the browser.

## Realtime edge cases

Manually test these when changing audio, transcript, or hint code:

- initial silence does not create a hint;
- short clicks and noise do not repeatedly restart a pause;
- STT disconnects leave local recording and deterministic pause guidance usable;
- duplicate final messages do not duplicate transcript entries;
- delayed AI responses for stale contexts are ignored;
- only one hint request is in flight;
- recording again clears the previous conversation history;
- stopping during a partial turn does not claim that partial as final speech.

## Performance target

For an active browser tab, measure at least 20 local or cached hint displays. The
target is p95 under 100 ms from blank confirmation to visible card. Do not
include network AI generation time in this local-display measurement.

This is a validation target, not a guarantee for background browser tabs or
provider latency.

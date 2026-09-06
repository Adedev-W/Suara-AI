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
The frontend `test` command is a TypeScript compilation smoke check because no
runtime browser test dependency is currently installed.

## Manual acceptance

1. Open the setup screen, choose Topic, Notes, or Key points, and submit text.
2. Confirm the Talk Map contains 3–7 concise nodes and that moving a node is
   saved before camera readiness.
3. Allow camera and microphone access. Confirm the preview is mirrored in the
   readiness and recording screens.
4. Start recording. Confirm the timer advances in real time, the partial
   transcript appears, and a final turn updates the transcript and Talk Map.
5. Pause for at least 1.8 seconds to observe hesitation behavior, then pause
   beyond 3 seconds to observe a stronger cue. Resume speaking and confirm the
   recovered message and cooldown behavior.
6. Press Hint manually and confirm a cue appears without exposing a full script.
7. Stop recording, play the local preview, and download the WebM recording.
8. Request feedback and confirm the result includes strengths, improvements,
   useful phrases, and a concrete next practice.
9. Upload a text-bearing PDF or PPTX, ask a question about it, and confirm the
   answer includes retrieved source metadata. Uploading an unsupported type or
   unreadable document should return a controlled error.
10. Open browser developer tools and confirm the long-lived AssemblyAI key is
    absent from frontend requests and storage.

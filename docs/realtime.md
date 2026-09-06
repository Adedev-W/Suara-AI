# Realtime recording path

The browser requests `POST /api/v1/stt/token` immediately after recording
starts. The backend creates a short-lived AssemblyAI streaming token with the
server-side API key and returns the configured speech model. The browser then
opens the AssemblyAI v3 WebSocket and sends the temporary token in the query
string.

Audio uses the browser's `AudioWorklet` to read microphone samples, resamples
them to 16 kHz, encodes little-endian signed PCM16, and sends roughly 100 ms
chunks. AssemblyAI final turns are appended to the local transcript; partial
turns are shown as live text. The browser also feeds the same camera and
microphone stream into `MediaRecorder`, so preview and download remain local.

The assistance state machine is intentionally deterministic:

- `FLOWING`: speech has usable progress and no intervention is needed.
- `HESITATING`: at least 1.8 seconds of silence, filler density, or repetition
  suggests a pause that may need a small keyword cue.
- `STUCK`: more than 3 seconds of silence with low semantic progress produces a
  starter phrase and next idea.
- `RECOVERED`: meaningful speech resumes after hesitation or a stuck state.

After recovery, a 6 second cooldown suppresses repeated cues. A manual Hint
button goes directly to the strongest available cue. Talk Map matching advances
only when the next node's keyword score clears the current node by a margin, so
normal pauses do not cause aggressive section changes.

The backend receives the final transcript and structured state events only when
the speaker chooses to request feedback. It does not receive the video blob.

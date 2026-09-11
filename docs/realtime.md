# Realtime recording path

The browser requests `POST /api/v1/stt/token` immediately after recording
starts. The backend creates a short-lived AssemblyAI streaming token with the
server-side API key and returns the configured speech model. The browser then
opens the AssemblyAI v3 WebSocket and sends the temporary token in the query
string.

Audio uses the browser's `AudioWorklet` to read microphone samples, resamples
them to 16 kHz, encodes little-endian signed PCM16, and sends roughly 100 ms
chunks. AssemblyAI final turns are appended to the local transcript; partial
turns are shown as live text and are not used as stable semantic evidence. The
browser also feeds the same camera and microphone stream into `MediaRecorder`,
so preview and download remain local.

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

The browser keeps final turns in a bounded rolling window and accumulates
covered concepts for the active Talk Map node. A node requires evidence across
more than one finalized observation before it is marked covered, and a short
transition grace period suppresses an immediate repeat cue after completion.

When the state enters `STUCK`, the browser shows the deterministic Talk Map cue
immediately and requests `POST /api/v1/session/{id}/hint` in the background. The
backend uses the configured LLM gateway when available and returns a short
structured cue. If the request fails, the deterministic cue remains visible;
recording and STT are not dependent on this request. The browser aborts a hint
request after four seconds so a slow provider response cannot replace a cue for
an outdated speaking moment. The request is an explicit extension of the PRD's
pre-recording-only LLM scope; the deterministic path remains the MVP fallback.

The backend receives only the bounded recent final-transcript window needed for
a rescue hint during recording. The complete transcript and structured state
events are sent when the speaker chooses to request feedback. It does not
receive the video blob.

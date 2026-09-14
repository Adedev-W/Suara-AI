# Realtime recording path

The browser requests `POST /api/v1/stt/token` immediately after recording
starts. The backend creates a short-lived AssemblyAI streaming token with the
server-side API key and returns the configured speech model. The browser then
opens the AssemblyAI v3 WebSocket and sends the temporary token in the query
string.

Audio uses the browser's `AudioWorklet` to read microphone samples, resamples
them to 16 kHz, encodes little-endian signed PCM16, and emits roughly 100 ms
chunks. The same chunks provide browser-local voice activity before they are
sent to AssemblyAI. Two consecutive chunks above the speech threshold count as
voice activity. AssemblyAI partial turns update the visible rolling transcript
while the speaker is talking. Only final turns update the canonical transcript,
Talk Map, and hint context; they do not control the silence clock, so a delayed
final turn cannot dismiss a valid rescue cue. The camera and microphone stream
also feeds `MediaRecorder`, so preview and download remain local.

The assistance lifecycle is intentionally deterministic:

- `FLOWING`: the microphone is receiving speech and no intervention is needed.
- `STUCK`: after speech has started, 1.5 seconds without local voice activity
  produces a starter phrase and next idea.

Local voice activity moves `STUCK` directly back to `FLOWING` and dismisses the
cue. The previous cue stays mounted only long enough for its CSS opacity
transition; it is already inactive and hidden from assistive technology.

No automatic hint appears before the first detected speech. A stuck episode
remains stable during continued silence and sends at most one AI request. Voice
activity aborts that request, fades the cue, and arms a fresh 1.5-second episode
without a cooldown. A manual Hint button uses the same fallback and request
lifecycle. Talk Map matching still advances only when the next node's keyword
score clears the current node by a margin.

The browser keeps the complete final transcript for preview and feedback, plus
a bounded rolling final-transcript context for hint requests. The recording UI
shows the latest roughly 1,800 characters and the current partial turn in a
separate subdued style. Covered concepts accumulate for the active Talk Map
node, and a node requires evidence across more than one finalized observation
before it is marked covered.

When the state enters `STUCK`, the browser shows the deterministic Talk Map cue
immediately and requests `POST /api/v1/session/{id}/hint` in the background. The
backend uses a three-second LLM timeout and returns a short structured cue. If
the provider fails, the backend returns a deterministic cue with
`source="deterministic"` and logs a sanitized diagnostic; recording and STT are
not dependent on this request. The browser aborts its request after four
seconds. An AI response replaces the visible fallback only while the same
speaker-pause episode and Talk Map node are still active.

The backend receives only the bounded recent final-transcript window needed for
a rescue hint during recording. The complete transcript and structured state
events are sent when the speaker chooses to request feedback. It does not
receive the video blob.

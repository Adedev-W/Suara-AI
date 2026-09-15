# Realtime recording path

AudioWorklet captures microphone samples and sends 50 ms PCM16 chunks at 16 kHz.
The same samples feed an adaptive RMS/hysteresis detector. Pause duration uses
sample counts rather than JavaScript callback cadence. Provider word offsets
are anchored to the captured stream's start; arrival time is recorded separately.

The client waits for AssemblyAI's Begin message before reporting Listening.
For universal-3-5-pro it explicitly selects balanced mode, continuous partials,
128 ms minimum turn silence and 800 ms maximum turn silence. Provider endpoints
finalize text; they do not decide when a help card should appear. Up to ten
seconds of startup audio are retained in order. Overflow disables transcription
with a diagnostic rather than dropping earlier frames and corrupting timestamps.
Token issuance and socket initialization each have an eight-second timeout.

## Speech and context

Turn messages replace previous content for their turn_order. Finalized turns
cannot be overwritten by late partials, and duplicate finals do not duplicate
the transcript or conversation log. The rolling hint context includes final and
partial text (up to 6,000 characters); preview and feedback use final text only.

Local activity requires 200 ms above an adaptive threshold. While STT is online,
a new automatic blank also requires new provider-confirmed speech. Late final
messages from an earlier pause cannot rearm noise-only episodes. Initial silence
does not display hints. Once armed, a hanging phrase waits 1,500 ms; terminal
punctuation waits 2,500 ms, except trailing connectives such as “because”.
This is a timing heuristic, not a reliable inference of the speaker's intentions.
When STT fails, local audio guidance uses a conservative 2,500 ms pause.

## Preparing and displaying hints

AI-generated Talk Maps contain three 40–70-word candidates per node: explanation,
example and transition. Older/deterministic maps without candidates retain the
legacy starter and prompt. New live hints carry a continuation of 40–70 words
and a semantic node suggestion. The server supplies the original input material,
the map, final and partial context, and up to five actually displayed hints.
Only an exact quote from final speech permits a permanent node-position update.
A quote does not mark all previous topics covered.

The controller debounces changed context for 300 ms and dispatches at most one
request per three seconds, with a single request in flight and latest-context
coalescing. Provider work is not assumed to stop when the browser aborts. A
three-second backend deadline includes structured-output retries; the client
aborts after four seconds. Prefetch can consume quota even when no blank occurs.

At a blank, a matching cached AI candidate or unseen local candidate appears
immediately. A live response can replace a fallback once within two seconds,
provided its context is still current and speech has not resumed. Normalized
punctuation-only changes preserve a candidate; substantive changes invalidate
it. No AI request streams partially validated text onto the card.

Resuming speech changes the card to a reading state without removing its text.
Dismiss hides it. The next blank can surface a fresh candidate; exhausted or
duplicate candidates retain the existing guidance instead of cycling repeatedly.
Manual Hint uses the same controller, but its display is not an automatic blank
entry. Request diagnostics remain visible in the log.

## Timeline and shutdown

The vertical, copyable Preview log contains speech start/end and transcript
arrival timestamps, pause start/detection times, actually displayed hints, and
collapsible diagnostics. Diagnostics distinguish provider fallback, request
timeout, stale context, and reading-window suppression. Request durations and
blank-to-display latency are recorded separately. Candidates never displayed
are not logged as shown hints.

Stopping ends assistance, flushes audio, sends Terminate, and reads until
Termination (or a three-second timeout). This allows the last final turn to
arrive before Preview. Timeout is recorded; the client does not claim an
unfinished partial is a final transcript. Recording again resets controller
history, pending requests, transcript turns, and the conversation timeline.

## Reference and validation

The streaming behavior follows AssemblyAI's
[message sequence](https://www.assemblyai.com/docs/streaming/message-sequence),
[turn detection](https://www.assemblyai.com/docs/streaming/turn-detection), and
[WebSocket API](https://www.assemblyai.com/docs/streaming/api-spec/streaming-websocket).
Run Node behavioral tests with `make test-frontend`. The browser acceptance
target is p95 blank-to-local/cache-display below 100 ms in an active tab; this
is a measurement target, not a guarantee for background tabs or AI network
latency. See [validation.md](validation.md) for microphone acceptance scenarios.

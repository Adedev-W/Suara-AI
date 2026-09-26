# Realtime behavior

This document records the timing and safety rules behind realtime practice. It
is intended for contributors debugging audio, transcript, or hint behavior.

## Audio and transcription

The browser's AudioWorklet captures mono PCM16 audio at 16 kHz in 50 ms chunks.
Those samples are sent to AssemblyAI and also feed a local adaptive RMS/
hysteresis pause detector. Local pause timing uses sample counts rather than
JavaScript callback timing.

The client waits for AssemblyAI's `Begin` message before showing the Listening
state. The current `universal-3-5-pro` path selects balanced mode, continuous
partials, 128 ms minimum turn silence, and 800 ms maximum turn silence. Token
issuance and socket initialization each have an eight-second deadline.

Up to ten seconds of startup audio is retained in order. If that buffer would
overflow, transcription is disabled with a diagnostic rather than silently
dropping early audio and corrupting timestamps.

## Transcript consistency

Provider messages are keyed by `turn_order`. A newer message replaces earlier
content for the same turn. Finalized turns cannot be overwritten by late
partials, and duplicate finals do not create duplicate transcript or timeline
entries.

The browser keeps final and partial text in a bounded rolling hint context of up
to 6,000 characters. Preview and feedback use final text only.

## Pause detection

- The speaker must produce sustained activity before an automatic blank can be
  considered.
- The pause threshold is 1,500 ms after speech has started.
- Activity shorter than 200 ms does not restart the pause timer.
- Initial silence does not show an automatic hint.
- When STT is online, a new automatic blank also requires new provider-confirmed
  speech so background noise does not repeatedly trigger cards.
- Manual Hint remains available even when automatic pause detection is not
  triggered.

## Hint lifecycle

The browser debounces finalized transcript or active-node changes for 300 ms. It
dispatches at most one request every three seconds, allows one request in
flight, and keeps the latest context when requests overlap in time.

At a confirmed blank, a cached AI candidate or an unseen deterministic candidate
can appear immediately. A live response can replace that fallback once within
two seconds only if the context is still current and speech has not resumed.
Responses for stale contexts are ignored.

Resuming speech changes the card to a reading state without removing its text.
Dismiss hides the card. Showing a hint does not mark its Talk Map node as
covered. A permanent node-position suggestion requires an exact quote from
final speech.

## Stop and restart

Stopping ends assistance, flushes audio, sends AssemblyAI `Terminate`, and waits
up to three seconds for the termination sequence. The client does not convert an
unfinished partial into final speech after a timeout.

Starting a new recording resets transcript turns, pending requests, pause
episodes, controller history, and the conversation timeline.

## Provider references

The streaming behavior follows AssemblyAI's
[message sequence](https://www.assemblyai.com/docs/streaming/message-sequence),
[turn detection](https://www.assemblyai.com/docs/streaming/turn-detection), and
[WebSocket API](https://www.assemblyai.com/docs/streaming/api-spec/streaming-websocket).

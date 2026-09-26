# Product brief

## What SuaraAI is

SuaraAI is a speaking practice companion for people who need to explain ideas
clearly in English. It gives a short structure before practice, listens while
the speaker talks, and offers just-in-time guidance when the speaker loses
their train of thought.

SuaraAI is designed to support a short explanation, not to write a speech for
the user. The speaker remains responsible for the ideas and wording.

## Problem statement

People often know a subject but cannot explain it smoothly. During practice,
they may:

- start without a clear order;
- repeat an idea instead of moving forward;
- pause because they do not know what to say next;
- receive feedback too late to connect it to the moment of difficulty.

SuaraAI solves this by combining a lightweight speaking plan, realtime speech
awareness, contextual prompts, and a review after the practice session.

## Who it is for

SuaraAI is useful for someone preparing to:

- explain a project or technical idea;
- present notes in a meeting or class;
- practice an interview answer;
- improve confidence speaking English;
- turn study material into a short spoken explanation.

## The experience

### 1. Start with your material

The speaker enters a topic, notes, or key points. SuaraAI turns the input into
a Talk Map with three to seven sections.

### 2. Make the plan yours

The speaker can review and reorder the Talk Map before recording. The map is a
guide, not a script.

### 3. Practice out loud

The browser shows a camera preview, records locally, and displays the live
transcript. The speaker can focus on explaining rather than managing the plan.

### 4. Get help at the right moment

After speech has started, a sustained pause can show a short continuation or
next idea. The speaker can also request a hint manually. Guidance remains
readable while the speaker resumes talking.

### 5. Learn from the attempt

After recording, SuaraAI shows feedback about strengths, improvements, useful
phrases, and one concrete next practice.

### 6. Use supporting material

The speaker can upload a text-bearing PDF or PPTX and ask a question about it.
Answers include the document and page or slide information when available.

## Product principles

- Keep the speaker in control of the explanation.
- Help with the next step instead of replacing the speaker's voice.
- Show local guidance quickly when possible.
- Treat delayed provider responses as optional, never as a reason to stop
  recording.
- Make the practice attempt reviewable through a clear timeline.

## Current boundaries

The current product is a single-person web practice tool. It does not provide
accounts, collaboration, long-term video storage, meeting transcription,
medical or legal coaching, or a guarantee that generated feedback is correct.

Video remains in the browser. Session data and indexed document text may be
stored in PostgreSQL when the full persisted stack is enabled. Provider keys
remain on the backend; the browser receives only a short-lived speech token.

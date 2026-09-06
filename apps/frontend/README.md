# SuaraAI web client

This React and TypeScript client implements the browser flow from the PRD:
setup, Talk Map review, camera readiness, realtime speaking assistance, local
recording review, structured feedback, and optional materials Q&A.

## Commands

Run these from `apps/frontend`, or add `--prefix apps/frontend` when running
them from the repository root:

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
```

The client reads `VITE_API_BASE_URL` at build time and defaults to `/api/v1`.
The Vite development proxy forwards that path to the local FastAPI server.

The frontend does not currently include a browser test runner. `npm run test`
therefore runs the TypeScript compilation smoke check used by the repository
workflow. Pure browser integrations should be manually verified with the
checklist in `../../docs/validation.md` until a test runner is introduced.

## Browser requirements

The recording flow requires camera and microphone permission, `MediaRecorder`,
`AudioWorklet`, and a secure context in production. The browser sends 16 kHz
mono PCM16 audio to the AssemblyAI streaming socket and retains the video blob
locally for playback and download.

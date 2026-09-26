# Frontend development

The frontend is a React and TypeScript web client built with Vite. It owns the
camera preview, local video recording, microphone capture, realtime transcript
display, pause detection, hint visibility, and the conversation timeline.

For the complete product story and setup instructions, read:

- [the product brief](../../docs/product.md);
- [local setup](../../docs/setup.md);
- [realtime behavior](../../docs/realtime.md);
- [validation scenarios](../../docs/validation.md).

## Commands

Run these from the repository root:

```bash
npm --prefix apps/frontend ci
npm --prefix apps/frontend run dev
npm --prefix apps/frontend run lint
npm --prefix apps/frontend run format:check
npm --prefix apps/frontend run typecheck
npm --prefix apps/frontend run test
npm --prefix apps/frontend run build
```

The client reads `VITE_API_BASE_URL` at build time and defaults to `/api/v1`.
Vite's development proxy sends that path to the local FastAPI server.

## Browser requirements

Recording requires camera and microphone permission, `MediaRecorder`,
`AudioWorklet`, and a secure context. Use `localhost` during local development
or HTTPS on EC2.

The browser sends 16 kHz mono PCM16 audio to AssemblyAI's streaming socket. The
long-lived AssemblyAI key never enters frontend code or browser storage; the
backend issues a short-lived token first.

The frontend continues local recording and deterministic pause guidance when
provider work fails. Late AI responses are ignored when their context is stale.

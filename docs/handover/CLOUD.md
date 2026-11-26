# Voice Suite Cloud and Free Browser

The hosted Voice Suite site offers Cloud Mode, Free Browser Mode and a desktop connection. Cloud stores profiles, projects and audio in the project's private Neon Postgres database and calls the provider the user selects. Free Browser runs ONNX audio models on the user's device. The desktop connection keeps inference on the paired computer or on a shared Voice Suite server.

## Cloud deployment

Use the Neon integration connected to the existing `voice-suite` Vercel project. Set these values in the **server** environment for the intended deployment. The first Cloud sign-in creates the two Voice Suite tables. Preview data is scoped by Git branch. Use separate signing secrets and database branches for production and previews. Combined audio storage in the two tables is capped at 128 MiB of audio per database. Cloud stays unavailable until the operator enables it. Free Browser and the desktop connection do not require any provider credentials.

| Variable | Purpose |
| --- | --- |
| `VOICE_SUITE_CLOUD_ENABLED` | Set to `1` when storage, authentication and the budget are ready. |
| `VOICE_SUITE_CLOUD_SECRET` | An independently generated secret with at least 256 bits of entropy. Keep it in the deployment's secret store. |
| `DATABASE_URL` | The server-only Neon connection string injected by the integration. `POSTGRES_URL` also works. |
| `VOICE_SUITE_CLOUD_BUDGET` | JSON with a positive `monthly` amount in USD and positive cost ceilings for the operations you enable. |
| `ELEVENLABS_API_KEY` | Optional server API key with voice creation, deletion and speech permissions. |
| `OPENAI_API_KEY` | Optional project API key for preset speech and transcription. |
| `GROQ_API_KEY` | Optional project API key for Whisper transcription. |

Use `clone`, `elevenlabsSpeechPer1000`, `openaiSpeechPer1000`, `openaiTranscribePerMinute` and `groqTranscribePerMinute` for the operator's cost ceilings. A missing rate disables its operation. Set ceilings from your contract and configure provider-side quotas too. Voice Suite reserves the conservative cost before sending the request. It counts failed provider attempts because a timeout can occur after the vendor accepted a request. The allowance resets each UTC calendar month and applies to the entire deployment. Storage usage and provider plan fees are administered separately. [ElevenLabs API plans](https://elevenlabs.io/pricing/api) · [OpenAI API pricing](https://openai.com/api/pricing/) · [Groq speech pricing](https://console.groq.com/docs/speech-to-text)

Use stable, distinct invitation account IDs. On a trusted operator machine with the Cloud signing secret loaded from the secret store, run:

```sh
node scripts/cloud-invite.mjs existing-or-new-account-id
```

Give the person their own one-time invitation over a private channel. It expires after ten minutes. Issue another invitation with the same account ID to restore access to that person's existing workspace. The browser exchanges it for an eight-hour, host-only, Secure, HttpOnly cookie. Browser requests never receive provider or database credentials.

A user confirms ownership before a reference recording is stored. They separately approve sending audio or text to a selected provider. ElevenLabs Instant Voice Cloning uses their saved recording and must return a usable voice before synthesis. A request for provider verification blocks synthesis. Deleting a profile revokes its ElevenLabs voice as well as deleting the stored reference. Audio is delivered through the authenticated app and generated MP3 exports carry a synthetic-audio metadata tag. [ElevenLabs voice-clone API](https://elevenlabs.io/docs/api-reference/voices/ivc/create)

### Provider and subscription availability

- ElevenLabs supports API keys and API usage through its eligible plans. Verify Instant Voice Cloning, commercial-use rights and credit limits on the account that will own the server key. [ElevenLabs API pricing and features](https://elevenlabs.io/pricing/api)
- OpenAI speech and transcription use the API project's credentials. Custom voices from recordings require eligible API access and a separate recorded consent flow. The app uses built-in voices for OpenAI. Eligible Sign in with ChatGPT integrations can consume Work or Codex allowances under plan rules. That entitlement does not establish access to these Audio API routes. [OpenAI custom voices](https://developers.openai.com/api/docs/guides/custom-voices) · [Using a ChatGPT plan in other apps](https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites)
- Groq uses a GroqCloud API key and the account's documented free or paid API quota for Whisper. [Groq speech documentation](https://console.groq.com/docs/speech-to-text)
- Claude supports specific Agent SDK workflows with eligible subscriptions. Those are unrelated to the speech, transcription and cloning endpoints in this release. [Claude Agent SDK entitlements](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)

## Free Browser Mode

The first speech action loads Kokoro 82M Q8 (92.4 MB of weights). The first transcription loads Whisper Tiny English Q8 (40.9 MB of weights). The browser also downloads the ONNX runtime, voice and tokenizer files. Speech prefers WebGPU with a WebAssembly fallback. Transcription uses WebAssembly. Microphone audio, transcripts and prompts stay in the browser. Browser mode offers English speech, transcription and tagged WAV export. Use Cloud or the desktop application for cloning. [Kokoro ONNX model](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) · [Whisper Tiny English model](https://huggingface.co/Xenova/whisper-tiny.en)

## Hosted desktop connections

Open Voice Suite and finish installing the speech model. In the hosted app, choose **Desktop app**, connect to **This computer**, grant the browser local-network access if asked, and approve the request in Voice Suite. The app binds its discovery listener to loopback. Only the production site can request a session. The resulting credential can generate or transcribe and read studio audio for an hour. Desktop configuration and filesystem operations stay behind their existing native permissions. Disconnecting revokes the session.

For a shared server, configure HTTPS, the server's operator key and an exact allowed origin. From a trusted operator session, use its master key as an Authorization bearer header for `POST /api/auth/studio/invite`. Deliver the HTTPS base URL followed by `#` and the returned one-time code as an invitation. Users paste that invitation into the hosted app's **Shared production server** panel. If the deployment sets `VITE_VOICE_SUITE_BACKEND_URL` to a trusted HTTPS service, a user can enter the code by itself. The operator key stays server-side. A shared server provides one shared workspace to its invitees. Use Cloud Mode for isolated accounts.

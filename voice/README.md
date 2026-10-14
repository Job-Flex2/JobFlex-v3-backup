# The AI desk's voice server

A small always-on Node service that bridges a Twilio call (media stream) to OpenAI's realtime voice and calls JobFlex's internal API for open times, bookings, messages and the call's wrap-up. It holds no Twilio credentials and no database. Code: `server.mjs` (the plumbing), `call.mjs` (one call), `test/` (fakes for OpenAI, JobFlex and Twilio).

## Run the tests

```
cd voice && npm install && npm test
```

## Rehearse with the real OpenAI API (no phone, no Fly)

```
cd voice && OPENAI_API_KEY=sk-… node test/live.mjs
```

The real voice server talks to the real realtime API while this script plays Twilio's side of the call with a scripted caller (spoken by OpenAI's speech model, resampled to a phone line) who asks for a roof visit, picks a time, gives a name and number, and says goodbye. It prints pass/fail for each thing that must be true on a live call — the desk speaks first, the caller is heard, open times are looked up, the visit is booked, the desk hangs up after its goodbye — then the whole conversation, and saves the desk's voice to `test/out/desk-<time>.wav` so you can listen. A few cents per run. `VOICE_MODEL`, `REALTIME_API` and `LIVE_VOICE` are honoured; `LIVE_INSTRUCTIONS_FILE=…` rehearses with a company's real instructions.

## Put it on Fly.io (the owner, once)

1. Install the Fly CLI and sign up: `brew install flyctl` · `fly auth signup` (add a card on fly.io → Billing).
2. From this folder: `fly launch --no-deploy --copy-config --name jobflex-voice --region sea` (accept the defaults; say no to a Postgres or Redis).
3. Secrets — type them into the terminal, never into a chat or a file:
   ```
   fly secrets set OPENAI_API_KEY='sk-…' VOICE_SERVER_SECRET="$(openssl rand -hex 32)" APP_URL='https://www.jobflex.app'
   ```
   Keep the `VOICE_SERVER_SECRET` value: the app needs the same one.
4. `fly deploy` — then `curl https://jobflex-voice.fly.dev/health` answers `{"ok":true,…}`.
5. The name: `fly certs add voice.jobflex.app`, then add the DNS records it prints (a CNAME `voice` → `jobflex-voice.fly.dev`, or the A/AAAA it shows) where jobflex.app's DNS is managed. `fly certs check voice.jobflex.app` until it says ready.
6. On Vercel (the JobFlex project → Settings → Environment Variables, Production):
   `VOICE_SERVER_URL = wss://voice.jobflex.app` and `VOICE_SERVER_SECRET = <the same value as in step 3>`, then redeploy.

Until step 6 is done the app keeps its voicemail; the moment both variables are set, the desk answers live.

## Knobs

- `VOICE_MODEL` (default `gpt-realtime-mini`; `gpt-realtime` for the full model, about three times the cost). The app's "Test it here" (Settings → AI desk) reads the same variable on Vercel — set both to change the model everywhere.
- `REALTIME_API` — `ga` (default) or `beta` for an account still on the older session shape.
- A call is capped at the `maxSeconds` the app sends (10 minutes by default); the desk is told to wrap up 30 s before.

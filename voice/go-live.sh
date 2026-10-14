#!/usr/bin/env bash
# THE VOICE SERVER ONTO FLY.IO, IN ONE GO — run from this folder: bash go-live.sh
#
# What it does: checks the Fly CLI and your sign-in, creates the app "jobflex-voice" once,
# asks for your OpenAI key (typed, never shown), makes the shared secret the app and the
# server use between themselves, sets the three secrets on Fly, deploys, checks /health,
# and prints the two lines to paste into Vercel. Run it again any time: it only re-deploys.
set -euo pipefail
cd "$(dirname "$0")"

FLY=$(command -v fly || command -v flyctl || true)
if [ -z "$FLY" ]; then
  echo "Install the Fly CLI first:   brew install flyctl"
  echo "then sign up or in:          fly auth signup   (or: fly auth login)"
  exit 1
fi
if ! "$FLY" auth whoami >/dev/null 2>&1; then
  echo "Sign in to Fly first:        $FLY auth login"
  exit 1
fi

APP=jobflex-voice
if ! "$FLY" status -a "$APP" >/dev/null 2>&1; then
  echo "Creating the app $APP in Seattle (no deploy yet)…"
  "$FLY" launch --no-deploy --copy-config --name "$APP" --region sea --yes
fi

if "$FLY" secrets list -a "$APP" 2>/dev/null | grep -q "^VOICE_SERVER_SECRET"; then
  echo "Secrets are already set on $APP — keeping them (fly secrets set … to change)."
  SECRET=""
else
  read -rsp "Your OpenAI API key (sk-…; it is not shown): " KEY; echo
  [ -n "$KEY" ] || { echo "No key given."; exit 1; }
  SECRET=$(openssl rand -hex 32)
  "$FLY" secrets set -a "$APP" --stage OPENAI_API_KEY="$KEY" VOICE_SERVER_SECRET="$SECRET" APP_URL="https://www.jobflex.app" >/dev/null
  echo "Secrets set."
fi

echo "Deploying…"
"$FLY" deploy -a "$APP"

echo
printf "Health: "
sleep 3
curl -s --max-time 10 "https://$APP.fly.dev/health" || echo "(no answer yet — wait a minute and open https://$APP.fly.dev/health)"
echo
echo
echo "Now on Vercel → the JobFlex project → Settings → Environment Variables → Production, then Redeploy:"
echo "  VOICE_SERVER_URL      wss://$APP.fly.dev"
if [ -n "$SECRET" ]; then
  echo "  VOICE_SERVER_SECRET   $SECRET"
else
  echo "  VOICE_SERVER_SECRET   (the value you set before — the same one)"
fi
echo
echo "Then /admin/health → AI desk · go live shows the Voice server light green."

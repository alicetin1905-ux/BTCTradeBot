#!/usr/bin/env bash
# One-time setup on the Mac that runs the BTC bot:
#   - git identity + a GitHub token for THIS repo only, so runs can push state/demo/
#   - first upload of state/demo/ so the dashboard fills
#   - cron: full run every 30 min (:02 and :32), quick sync every 5 minutes (all coins in config.js)
# Safe to run again, and safe next to TradeBot on the same Mac: it only
# replaces its own btc-run.sh cron lines, and keeps its token in its own
# file (~/.btctradebot-git-credentials), so TradeBot's saved token and cron
# lines are left untouched.
#
#   cd ~/BTCTradeBot && bash scripts/setup-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"
USER_NAME="alicetin1905-ux"
CRED_FILE="$HOME/.btctradebot-git-credentials"

echo "BTCTradeBot setup in $REPO_DIR"

if [ ! -f .env ]; then
  echo "No .env here — create it first (cp .env.example .env, then add your OKX (or Bybit) demo key)." >&2
  exit 1
fi

chmod +x scripts/btc-run.sh scripts/reset.sh

git config user.name "$USER_NAME"
git config user.email "$USER_NAME@users.noreply.github.com"
# This checkout uses only its own credential file: the empty value clears any
# helper from the global config (e.g. the macOS keychain or TradeBot's token).
git config --replace-all credential.helper ''
git config --add credential.helper "store --file=$CRED_FILE"

if [ ! -s "$CRED_FILE" ]; then
  echo
  echo "Paste a GitHub token (fine-grained, repository BTCTradeBot, Contents: Read and write)."
  echo "Nothing is shown while you paste — press Enter afterwards."
  read -r -s TOKEN
  echo
  [ -n "$TOKEN" ] || { echo "No token entered — stopping." >&2; exit 1; }
  umask 077
  printf 'https://%s:%s@github.com\n' "$USER_NAME" "$TOKEN" > "$CRED_FILE"
  chmod 600 "$CRED_FILE"
  unset TOKEN
fi

git pull -q --rebase --autostash || true

# Make sure state exists (one sync if the bot hasn't run here yet), then upload it.
if [ ! -f state/demo/account.json ]; then
  TRADEBOT_MODE=demo node src/run.js --sync || true
fi
git add state/demo/ 2>/dev/null || true
if ! git diff --cached --quiet; then
  git commit -q -m "Demo state (setup)"
fi
if git push -q; then
  echo "✓ Upload to GitHub works."
else
  echo "✗ git push failed — the token is probably wrong or lacks 'Contents: Read and write' on BTCTradeBot." >&2
  echo "  Remove it with:  rm $CRED_FILE   then run this script again." >&2
  exit 1
fi

# Replace any earlier btc-run.sh cron lines with the two we want; every other
# cron job (TradeBot's included) is kept as it is.
RUN="$REPO_DIR/scripts/btc-run.sh"
OTHER_JOBS="$(crontab -l 2>/dev/null | grep -v 'btc-run\.sh' || true)"
{
  [ -n "$OTHER_JOBS" ] && printf '%s\n' "$OTHER_JOBS"
  echo "2,32 * * * * PUSH_STATE=1 $RUN"
  echo "*/5 * * * * PUSH_STATE=1 $RUN sync"
} | crontab -
echo "✓ Schedule installed:"
crontab -l | grep btc-run.sh

echo
echo "Done. Dashboard: https://alicetin1905-ux.github.io/BTCTradeBot/"
echo "Keep the Mac awake (System Settings → Energy → Prevent automatic sleeping)."
echo "Log: tail -30 $REPO_DIR/logs/demo.log"

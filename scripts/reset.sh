#!/usr/bin/env bash
# Start the bot over from 2000 USDT, then upload it.
#   scripts/reset.sh                   close the BTC position on Bybit Demo + reset the bot
#   scripts/reset.sh --clear-history   ...and also wipe the trade history
# Holds the same lock as the scheduled runs, so none of them can run mid-reset.
# Only BTCUSDT is closed; other positions on the account are left alone.
set -euo pipefail
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
CLEAR="${1:-}"
cd "$(dirname "$0")/.."
mkdir -p logs

LOCK="logs/.run.lock"
for i in $(seq 1 90); do
  mkdir "$LOCK" 2>/dev/null && break
  [ "$i" = 90 ] && { echo "Another bot run is still busy — try again in a few minutes." >&2; exit 1; }
  sleep 2
done
trap 'rm -rf "$LOCK"' EXIT

git pull -q --rebase --autostash || echo "git pull failed — resetting the current checkout"

echo "Closing the BTC position and cancelling its orders on Bybit demo…"
TRADEBOT_MODE=demo node src/run.js --close-all
TRADEBOT_MODE=demo node src/run.js --reset
if [ "$CLEAR" = "--clear-history" ]; then
  echo '[]' > state/demo/trades.json
  echo "Trade history cleared."
fi

git add state/demo/
if ! git diff --cached --quiet; then
  git commit -q -m "Reset demo account"
  git push -q || { git pull --rebase -q && git push -q; }
  echo "✓ Uploaded — the dashboard shows the reset within a minute."
else
  echo "Nothing changed."
fi

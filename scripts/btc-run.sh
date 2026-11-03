#!/usr/bin/env bash
# Bot runs for cron on the Mac (see README / scripts/setup-mac.sh).
#   scripts/btc-run.sh            full hourly run on the demo account (OKX, .env), for every coin in config.js COINS
#   scripts/btc-run.sh sync       quick sync of the position/fills only
# Pulls the latest code, runs the bot, and — if PUSH_STATE=1 — commits
# state/demo/ back to GitHub for the dashboard. Logs: logs/demo.log.
# (Named btc-run.sh, not exchange-run.sh, so TradeBot's setup on the same
# Mac, which replaces every exchange-run.sh cron line, leaves this one alone.)
set -euo pipefail
# cron starts with a bare PATH; add where Node/git usually live (nodejs.org
# installer, Homebrew on Apple Silicon and Intel).
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
ARGS=()
[ "${1:-}" = "sync" ] && ARGS=(--sync)
cd "$(dirname "$0")/.."
mkdir -p logs

# One run at a time (they share the git checkout). A sync skips if another
# run is busy; a full run waits up to 3 minutes.
LOCK="logs/.run.lock"
TRIES=$([ ${#ARGS[@]} -gt 0 ] && echo 1 || echo 90)
got_lock=0
for _ in $(seq 1 "$TRIES"); do
  if mkdir "$LOCK" 2>/dev/null; then got_lock=1; break; fi
  # Stale lock from a crashed run (older than 15 min): take it over.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then rm -rf "$LOCK"; continue; fi
  [ "$TRIES" -gt 1 ] && sleep 2
done
[ "$got_lock" = 1 ] || exit 0
trap 'rm -rf "$LOCK"' EXIT

{
  if [ ${#ARGS[@]} -eq 0 ]; then echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="; fi
  git pull --rebase --autostash -q || echo "git pull failed — running current checkout"
  # .env holds the keys (OKX_API_*, OKX_API_BASE, OKX_MARGIN_MODE, NTFY_TOPIC): load it for the shell too, so the
  # instrument defaults in scripts/lib-coins.sh see OKX_INSTRUMENT. Then every coin in config.js COINS, one process each.
  set -a; [ -f .env ] && . ./.env; set +a
  . scripts/lib-coins.sh
  run_all_coins ${ARGS[@]+"${ARGS[@]}"} || echo "at least one coin failed — see above"

  if [ "${PUSH_STATE:-0}" = "1" ]; then
    git add state/demo/
    if ! git diff --cached --quiet; then
      git commit -q -m "Demo ${ARGS[*]:-run} $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      git push -q || { git pull --rebase -q && git push -q; }
    fi
  fi
} >> logs/demo.log 2>&1

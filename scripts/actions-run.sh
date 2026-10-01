#!/usr/bin/env bash
# The bot on GitHub Actions (.github/workflows/bot.yml) — no Mac needed.
#   scripts/actions-run.sh run     full run (exit / trail / enter), then upload state/demo/
#   scripts/actions-run.sh sync    sync the position and fills only, then upload
#   scripts/actions-run.sh check   read-only OKX check (reachability, keys, account mode)
#   scripts/actions-run.sh testtrade   open + close the smallest position (scripts/okx-testtrade.js; COIN=ETH for another coin)
# A run or sync goes through every coin in config.js COINS, one `node src/run.js`
# process each (COIN=<coin>), BTC's instrument from OKX_INSTRUMENT, the others
# from OKX_INSTRUMENT_<COIN> or <COIN>-USD_UM_XPERP-310328 (NEAR: -310725). One coin failing
# doesn't stop the others; the exit status is non-zero if any failed.
# Keys come from the repository's Actions secrets (OKX_API_KEY,
# OKX_API_SECRET, OKX_API_PASSPHRASE). Until they're set, every run only does
# the check, so nothing fails while you're still setting up.
set -uo pipefail
MODE="${1:-run}"
cd "$(dirname "$0")/.."
export TRADEBOT_MODE=demo
export EXCHANGE="${EXCHANGE:-okx}"

if [ "$MODE" = "check" ]; then
  node scripts/okx-check.js
  exit $?
fi
BTC_INSTRUMENT="${OKX_INSTRUMENT:-BTC-USD_UM_XPERP-310328}"
inst_for() {
  local coin="$1" var="OKX_INSTRUMENT_$1"
  if [ -n "${!var:-}" ]; then echo "${!var}"
  elif [ "$coin" = "BTC" ]; then echo "$BTC_INSTRUMENT"
  # The demo account's perpetual-style futures: most expire 2031-03-28, NEAR's 2031-07-25 (okx-check lists them).
  elif [ "$coin" = "NEAR" ]; then echo "NEAR-USD_UM_XPERP-310725"
  else echo "$coin-USD_UM_XPERP-310328"; fi
}

if [ "$MODE" = "testtrade" ]; then
  export COIN="${COIN:-BTC}"
  # An explicit instrument (workflow input) wins; otherwise this coin's own.
  [ -n "${TESTTRADE_INSTRUMENT:-}" ] && export OKX_INSTRUMENT="$TESTTRADE_INSTRUMENT" || export OKX_INSTRUMENT="$(inst_for "$COIN")"
  node scripts/okx-testtrade.js
  exit $?
fi
if [ -z "${OKX_API_KEY:-}" ] || [ -z "${OKX_API_SECRET:-}" ] || [ -z "${OKX_API_PASSPHRASE:-}" ]; then
  echo "::warning::OKX keys are not set yet (Settings → Secrets and variables → Actions) — only checking the connection."
  node scripts/okx-check.js || true
  exit 0
fi

LOG="${RUNNER_TEMP:-/tmp}/btcbot-run.log"
: > "$LOG"
ARGS=()
[ "$MODE" = "sync" ] && ARGS=(--sync)
STATUS=0
for COIN in $(node -p "require('./config').COINS.join(' ')"); do
  echo "::group::$COIN"
  COIN="$COIN" OKX_INSTRUMENT="$(inst_for "$COIN")" node src/run.js ${ARGS[@]+"${ARGS[@]}"} 2>&1 | tee -a "$LOG"
  S=${PIPESTATUS[0]}
  echo "::endgroup::"
  if [ "$S" != 0 ]; then echo "::error::$COIN run failed (exit $S)"; STATUS=$S; fi
done

# Phone alert when runs start failing (repeated every 6h) and when they recover.
node scripts/actions-alert.js "$STATUS" "$LOG" || true

git config user.name "btctradebot"
git config user.email "actions@users.noreply.github.com"
git add state/
if ! git diff --cached --quiet; then
  git commit -q -m "Actions $MODE $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  PUSHED=0
  for i in 1 2 3 4 5; do
    if git push -q; then PUSHED=1; break; fi
    sleep $((i * 3))
    git pull --rebase --autostash -q || true
  done
  if [ "$PUSHED" != 1 ]; then
    echo "::error::could not upload state/demo/ — the next run would not know about this run's changes"
    node -e "require('./src/notify').push([{ title: 'BTC bot: state upload failed', message: 'GitHub push failed 5 times. The next run may not know about the latest trade — check the Actions log.', tags: ['warning'], priority: 4 }])" || true
    exit 1
  fi
fi
exit "$STATUS"

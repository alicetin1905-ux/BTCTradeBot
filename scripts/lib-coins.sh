#!/usr/bin/env bash
# Shared by scripts/actions-run.sh (GitHub) and scripts/btc-run.sh (Mac): which coins to run and on which OKX
# instrument. Source it from the repo root.
#   coins_list              the coins in config.js COINS, in run order (the last one is the lead)
#   inst_for <COIN>         that coin's OKX instrument: OKX_INSTRUMENT_<COIN> if set, else the default below
#   run_all_coins <args>    `COIN=<coin> OKX_INSTRUMENT=... node src/run.js <args>` for every coin; one failing
#                           coin doesn't stop the others; returns non-zero if any failed. Output goes to stdout.
BTC_INSTRUMENT="${OKX_INSTRUMENT:-BTC-USD_UM_XPERP-310328}"

coins_list() { node -p "require('./config').COINS.join(' ')"; }

inst_for() {
  local coin="$1" var="OKX_INSTRUMENT_$1"
  if [ -n "${!var:-}" ]; then echo "${!var}"
  elif [ "$coin" = "BTC" ]; then echo "$BTC_INSTRUMENT"
  # The demo account's perpetual-style futures (okx-check lists them): NEAR trades the spot pair, its futures are refused (OKX 51155).
  elif [ "$coin" = "NEAR" ]; then echo "NEAR-USDC"
  elif [ "$coin" = "UNI" ]; then echo "UNI-USD_UM_XPERP-310718"
  elif [ "$coin" = "HYPE" ]; then echo "HYPE-USD_UM_XPERP-310801"
  else echo "$coin-USD_UM_XPERP-310328"; fi
}

run_all_coins() {
  local status=0 coin s
  for coin in $(coins_list); do
    echo "--- $coin ---"
    COIN="$coin" OKX_INSTRUMENT="$(inst_for "$coin")" TRADEBOT_MODE=demo node src/run.js "$@"
    s=$?
    if [ "$s" != 0 ]; then echo "$coin run failed (exit $s)"; status=$s; fi
  done
  return $status
}

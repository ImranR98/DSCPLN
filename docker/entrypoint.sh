#!/bin/sh
# Select the app served by the unified D$CPLN image. Every deployment sets
# APP=portal|balance|file-pipelines|whatsapp-txt|task-runner.
set -eu

case "${APP:-}" in
  portal)
    : "${PORT:=8080}"
    : "${HOST:=0.0.0.0}"
    export PORT HOST
    exec node apps/portal/server.mjs
    ;;
  balance)
    exec node apps/balance-xlsx/server.mjs
    ;;
  file-pipelines)
    export HOME=/config
    exec node apps/file-pipelines/src/index.js \
      --config "${DSCPLN_CONFIG:-/config/config.json}" \
      --bind 0.0.0.0
    ;;
  whatsapp-txt)
    : "${DATA_DIR:=/data}"
    : "${HOST:=0.0.0.0}"
    : "${PORT:=8787}"
    export DATA_DIR HOST PORT
    exec node apps/whatsapp-txt/server.mjs --dir "$DATA_DIR" --host "$HOST" --port "$PORT"
    ;;
  task-runner)
    exec node apps/task-runner/server.mjs --host 0.0.0.0 --port "${PORT:-8085}" --no-browser
    ;;
  lockdown)
    : "${PORT:=8086}"
    : "${HOST:=0.0.0.0}"
    export PORT HOST
    exec node apps/lockdown/server.mjs
    ;;
  port-blocker)
    : "${PORT:=8794}"
    : "${HOST:=0.0.0.0}"
    export PORT HOST
    exec node apps/lockdown/blocker.mjs
    ;;
  *)
    echo "APP must be portal, balance, file-pipelines, whatsapp-txt, task-runner, lockdown or port-blocker (got '${APP:-}')" >&2
    exit 2
    ;;
esac

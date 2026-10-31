#!/usr/bin/env bash
# Starts the late-payment forecast service. Works from any folder and any terminal:
#   ./services/tabpfn/start.sh
# - creates .venv and installs the requirements on the first run
# - reads settings (HF_TOKEN, TABPFN_ENGINE, TABPFN_SERVICE_TOKEN, PORT) from services/tabpfn/.env if it exists
#   (.env is git-ignored; never commit it)
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "First run: creating .venv and installing requirements (torch is large, this takes a few minutes) ..."
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install -r requirements.txt
fi

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port "${PORT:-8808}"

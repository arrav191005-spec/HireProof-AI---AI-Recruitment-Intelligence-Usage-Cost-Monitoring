#!/bin/sh
# Starts the Python document service, preferring the project venv.
# Falls back to python3 with a clear message when the venv has not been
# created yet (python-service/README.md: python3 -m venv .venv && pip install -r requirements.txt).
set -e
cd "$(dirname "$0")/.."

if [ -x python-service/.venv/bin/python ]; then
  exec python-service/.venv/bin/python python-service/main.py
fi

echo "python-service/.venv not found — run:" >&2
echo "  python3 -m venv python-service/.venv" >&2
echo "  python-service/.venv/bin/pip install -r python-service/requirements.txt" >&2
exit 1

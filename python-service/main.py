"""HireProof AI document service entrypoint.

Run (from the repo root):
    python-service/.venv/bin/python python-service/main.py

Serves on 127.0.0.1, port from $PORT (default 8000). The Next.js server calls
it server-side via AI_SERVICE_URL.
"""

from __future__ import annotations

import uvicorn

from app import config

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=config.HOST,
        port=config.PORT,
        log_level="info",
        access_log=True,  # logs method + path + status only
    )

"""Sanitized, read-only verification queue monitoring.

The monitor uses the same restricted verification-worker login as the worker.
It never selects candidate rows, repository URLs, file paths, tokens, error
bodies or per-user records; migration 012 exposes aggregate counters through a
security-definer function instead.

    VERIFICATION_MONITOR_DATABASE_URL=...  python -m app.verification_monitor --json
"""
import argparse
import json
import os

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

from .verification_worker import WorkerConfigurationError, assert_worker_role


def monitor_engine():
    raw = (
        os.environ.get("VERIFICATION_MONITOR_DATABASE_URL", "").strip()
        or os.environ.get("VERIFICATION_WORKER_DATABASE_URL", "").strip()
    )
    if not raw:
        raise WorkerConfigurationError()
    url = make_url(raw)
    if url.get_backend_name() != "postgresql":
        raise WorkerConfigurationError()
    url = url.set(drivername="postgresql+psycopg")
    if "sslmode" not in url.query:
        url = url.update_query_dict({"sslmode": "verify-full"})
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})


def collect(engine) -> dict:
    with engine.begin() as conn:
        assert_worker_role(conn)
        metrics = conn.execute(text("select hp_verification_metrics() as metrics")).scalar_one()
    if not isinstance(metrics, dict):
        raise WorkerConfigurationError()
    return metrics


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="HireProof verification queue metrics")
    parser.add_argument("--json", action="store_true", help="emit a single JSON object")
    args = parser.parse_args(argv)
    engine = None
    try:
        engine = monitor_engine()
        metrics = collect(engine)
    except (WorkerConfigurationError, SQLAlchemyError, ValueError):
        print("Verification monitoring unavailable.")
        return 1
    finally:
        if engine is not None:
            engine.dispose()

    if args.json:
        print(json.dumps(metrics, sort_keys=True, default=str))
        return 0

    policy = metrics.get("policy") or {}
    print("HireProof verification queue")
    print(f"  queue depth:            {metrics.get('queue_depth', 0)}")
    print(f"  pending runs:           {metrics.get('pending_runs', 0)}")
    print(f"  running runs:           {metrics.get('running_runs', 0)}")
    print(f"  completed (24h):        {metrics.get('completed_last_24h', 0)}")
    print(f"  unavailable (24h):      {metrics.get('unavailable_last_24h', 0)}")
    print(f"  failed (24h):           {metrics.get('failed_last_24h', 0)}")
    print(f"  retrying jobs:          {metrics.get('retrying_jobs', 0)}")
    print(f"  rate-limited (24h):     {metrics.get('rate_limited_last_24h', 0)}")
    print(f"  oldest pending (sec):   {metrics.get('oldest_pending_seconds', 0)}")
    print(f"  average duration (sec): {metrics.get('average_duration_seconds_last_24h', 0)}")
    print(
        "  limits:                 "
        f"active/user={policy.get('max_active_per_user', '?')} "
        f"hourly/user={policy.get('max_requests_per_hour', '?')} "
        f"daily/user={policy.get('max_requests_per_day', '?')} "
        f"running={policy.get('max_running_jobs', '?')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

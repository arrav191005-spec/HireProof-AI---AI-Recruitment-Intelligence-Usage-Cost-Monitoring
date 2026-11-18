"""PostgreSQL connections; schema changes remain managed by database/migrations.

The URL is read only from the environment and never logged. The engine is
created lazily, so the existing document endpoints work without a database.
"""
from functools import lru_cache
import os

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session


class DatabaseNotConfigured(Exception):
    pass


@lru_cache(maxsize=1)
def get_engine():
    raw_url = os.environ.get("DATABASE_URL", "").strip()
    if not raw_url:
        raise DatabaseNotConfigured()
    url = make_url(raw_url)
    if url.get_backend_name() != "postgresql":
        raise DatabaseNotConfigured()
    # Explicitly use psycopg 3 for both standard postgres URL spellings.
    url = url.set(drivername="postgresql+psycopg")
    # Fail closed unless a deployment explicitly chooses another libpq mode.
    if "sslmode" not in url.query:
        url = url.update_query_dict({"sslmode": "verify-full"})
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 5})


def get_session():
    with Session(get_engine()) as session:
        yield session

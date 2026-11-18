"""Supabase access-token authentication, independent of authorization.

Only asymmetric tokens published in the configured issuer's JWKS are accepted.
An authenticated subject is not automatically a candidate or recruiter.
"""
from dataclasses import dataclass
from functools import lru_cache
import os
from urllib.parse import urlsplit

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientConnectionError, PyJWKClientError

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Identity:
    subject: str


def auth_settings() -> tuple[str, str]:
    issuer = os.environ.get("SUPABASE_AUTH_ISSUER", "").strip().rstrip("/")
    audience = os.environ.get("SUPABASE_JWT_AUDIENCE", "").strip()
    parsed = urlsplit(issuer)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment or not audience):
        raise HTTPException(status_code=503, detail="Authentication is not configured.")
    return issuer, audience


@lru_cache(maxsize=4)
def jwks_client(issuer: str) -> PyJWKClient:
    return PyJWKClient(issuer + "/.well-known/jwks.json", cache_jwk_set=True,
                       lifespan=300, timeout=5)


def require_identity(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> Identity:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authentication required.",
                            headers={"WWW-Authenticate": "Bearer"})
    issuer, audience = auth_settings()
    try:
        if len(credentials.credentials) > 8192:
            raise InvalidTokenError("Token too large")
        header = jwt.get_unverified_header(credentials.credentials)
        if header.get("alg") not in {"RS256", "ES256"} or not isinstance(header.get("kid"), str) or not header["kid"]:
            raise InvalidTokenError("Unsupported token header")
        key = jwks_client(issuer).get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(credentials.credentials, key.key, algorithms=["RS256", "ES256"],
                            issuer=issuer, audience=audience,
                            options={"require": ["exp", "iss", "aud", "sub"]})
        subject = claims["sub"]
        if not isinstance(subject, str) or not subject.strip():
            raise InvalidTokenError("Invalid subject")
    except PyJWKClientConnectionError:
        raise HTTPException(status_code=503, detail="Authentication provider unavailable.") from None
    except (InvalidTokenError, PyJWKClientError, ValueError, TypeError):
        raise HTTPException(status_code=401, detail="Invalid or expired credentials.",
                            headers={"WWW-Authenticate": "Bearer"}) from None
    return Identity(subject=subject)

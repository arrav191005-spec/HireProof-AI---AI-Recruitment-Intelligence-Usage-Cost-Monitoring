"""Confirm an authenticated identity and email directly with Supabase Auth."""
import os

import httpx
from fastapi import HTTPException

from .auth import Identity, auth_settings


def confirmed_email(identity: Identity, access_token: str) -> str:
    issuer, _ = auth_settings()
    publishable_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
    if not publishable_key:
        raise HTTPException(status_code=503, detail="Identity provider is not configured.")
    try:
        # Redirects are forbidden: the bearer token must never leave this host.
        with httpx.Client(timeout=5, follow_redirects=False) as client:
            with client.stream("GET", issuer + "/user", headers={
                "Authorization": "Bearer " + access_token, "apikey": publishable_key,
            }) as response:
                if response.status_code in (401, 403):
                    raise HTTPException(status_code=401, detail="Authentication required.")
                if response.status_code != 200:
                    raise HTTPException(status_code=503, detail="Identity provider unavailable.")
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 65536:
                        raise HTTPException(status_code=503, detail="Identity provider unavailable.")
        import json
        data = json.loads(raw)
        email = data.get("email")
        if (data.get("id") != identity.subject or not data.get("email_confirmed_at")
                or not isinstance(email, str) or len(email) > 254 or "@" not in email):
            raise HTTPException(status_code=403, detail="A confirmed provider identity is required.")
        return email
    except (httpx.HTTPError, ValueError, AttributeError):
        raise HTTPException(status_code=503, detail="Identity provider unavailable.") from None

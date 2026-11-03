from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

import bcrypt


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt(rounds=12)).decode("ascii")


def _decode_urlsafe(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("ascii"))


def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash:
        return False
    if stored_hash.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            compatible_hash = stored_hash.replace("$2y$", "$2b$", 1)
            return bcrypt.checkpw(password.encode("utf-8")[:72], compatible_hash.encode("ascii"))
        except (ValueError, TypeError):
            return False
    if not stored_hash.startswith("scrypt$"):
        return False
    try:
        _, n_value, r_value, p_value, salt_value, expected_value = stored_hash.split("$")
        n = int(n_value)
        r = int(r_value)
        p = int(p_value)
        salt = _decode_urlsafe(salt_value)
        expected = _decode_urlsafe(expected_value)
        if n < 2 or n & (n - 1) or not 1 <= r <= 32 or not 1 <= p <= 16:
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
            maxmem=max(32 * 1024 * 1024, 256 * n * r),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, MemoryError, OverflowError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

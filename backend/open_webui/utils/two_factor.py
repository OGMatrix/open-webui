"""Storing a second factor: the shared secret, and the way back in without it.

Two different problems, deliberately solved differently.

The TOTP secret has to come back out again — a code cannot be checked without
it — so it is encrypted, with a key that lives in the environment rather than
the database. A dump of the database alone then does not hand anyone a working
authenticator.

Recovery codes never need to come back out. They are only ever compared, so
they are hashed the same way passwords are, and a dump yields nothing usable.
That difference is also what makes them the escape hatch: rotating
WEBUI_SECRET_KEY makes every stored TOTP secret unreadable, and the recovery
codes still work because they never depended on it.
"""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken
from open_webui.env import WEBUI_SECRET_KEY
from open_webui.utils.auth import get_password_hash, verify_password
from open_webui.utils.totp import normalize_recovery_code

log = logging.getLogger(__name__)

#: A key of its own, from the same source.
#:
#: The purpose string keeps this ciphertext and the OAuth one from being
#: interchangeable: neither can be fed to the other's reader, and rotating one
#: does not quietly change what the other can read.
_PURPOSE = 'open-webui.totp.v1'


def _fernet() -> Fernet:
    digest = hashlib.sha256(f'{_PURPOSE}:{WEBUI_SECRET_KEY}'.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def seal_secret(secret: str) -> str:
    """Encrypt a TOTP secret for the database."""
    return _fernet().encrypt(secret.encode()).decode()


def open_secret(sealed: str | None) -> str | None:
    """Decrypt one, or None when it cannot be read.

    A secret encrypted under a key that has since changed is unreadable, and
    that is a failed second factor rather than a failed request: the account
    still has its recovery codes, which is exactly the situation they are for.
    """
    if not sealed:
        return None
    try:
        return _fernet().decrypt(sealed.encode()).decode()
    except (InvalidToken, ValueError, TypeError):
        log.warning('a stored TOTP secret could not be decrypted; recovery codes still apply')
        return None


async def hash_recovery_codes(codes: list[str]) -> list[str]:
    """Hash a fresh set for storage, the way a password would be."""
    return [await get_password_hash(normalize_recovery_code(code)) for code in codes]


async def take_recovery_code(candidate: str, hashes: list[str]) -> list[str] | None:
    """Spend one code, returning what is left, or None when it did not match.

    Every hash is tried even after one matches, so how long the attempt takes
    does not say which code was used or how far down the list it sat. The one
    that matched is then removed: a recovery code is good exactly once, or it
    is a password that happens to be shorter.
    """
    normalized = normalize_recovery_code(candidate)
    if not normalized or not hashes:
        return None

    matched_index = -1
    for index, stored in enumerate(hashes):
        if await verify_password(normalized, stored) and matched_index < 0:
            matched_index = index

    if matched_index < 0:
        return None
    return [stored for index, stored in enumerate(hashes) if index != matched_index]

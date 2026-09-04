"""Time-based one-time passwords, and the recovery codes that go with them.

RFC 6238, on the standard library. A dependency was avoidable here and worth
avoiding: the algorithm is short, fully specified, and — unusually — published
with its own test vectors, so this can be *checked* rather than trusted. Those
vectors are in ``test_totp.py``; if this file is ever touched, they are the
thing that says whether it still works.

Nothing here reads or writes anything. Storage, encryption and the login flow
are the caller's business; this only answers what a code should be and whether
one matches.
"""

from __future__ import annotations

import base64
import binascii
import hmac
import secrets
import struct
from urllib.parse import quote

#: Twenty bytes, which is what RFC 4226 calls for and what every authenticator
#: app expects. Base32 without padding, because the otpauth URI carries it in a
#: query string and padding only invites mangling.
SECRET_BYTES = 20

DIGITS = 6
PERIOD = 30

#: How many steps either side of now still count.
#:
#: One step, so a code stays good for a moment after it turns over and a moment
#: before — phones and servers disagree by seconds, and a person typing six
#: digits spends some of them. Widening this widens the window an intercepted
#: code stays useful in, so it does not widen.
WINDOW = 1


def generate_secret() -> str:
    """A fresh shared secret, base32, as an authenticator app expects it."""
    return base64.b32encode(secrets.token_bytes(SECRET_BYTES)).decode('ascii').rstrip('=')


def _decode_secret(secret: str) -> bytes:
    """Base32 back to bytes, tolerating the ways people retype a key."""
    cleaned = (secret or '').strip().replace(' ', '').replace('-', '').upper()
    if not cleaned:
        raise ValueError('empty secret')
    # b32decode insists on a multiple of eight; generate_secret strips it.
    padded = cleaned + '=' * (-len(cleaned) % 8)
    try:
        return base64.b32decode(padded, casefold=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError('not a base32 secret') from error


def hotp(secret: str, counter: int, digits: int = DIGITS, algorithm: str = 'sha1') -> str:
    """One code for one counter value — RFC 4226, which TOTP is built on."""
    digest = hmac.new(_decode_secret(secret), struct.pack('>Q', counter), algorithm).digest()
    # Dynamic truncation: the low nibble of the last byte picks where to read.
    offset = digest[-1] & 0x0F
    code = struct.unpack('>I', digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(code % (10**digits)).zfill(digits)


def totp(
    secret: str,
    timestamp: float,
    digits: int = DIGITS,
    period: int = PERIOD,
    algorithm: str = 'sha1',
) -> str:
    """The code for a moment in time.

    The timestamp is passed in rather than read here, so a test can name one
    and a caller can be sure which clock it is being judged against.
    """
    return hotp(secret, int(timestamp) // period, digits=digits, algorithm=algorithm)


def verify(
    secret: str,
    code: str,
    timestamp: float,
    digits: int = DIGITS,
    period: int = PERIOD,
    window: int = WINDOW,
    algorithm: str = 'sha1',
) -> bool:
    """Whether a code is one of the ones valid around that moment.

    Every candidate is compared, and compared in constant time, rather than
    returning on the first hit: how long a wrong answer takes should not say
    how nearly right it was.
    """
    candidate = (code or '').strip().replace(' ', '')
    if not candidate.isdigit() or len(candidate) != digits:
        return False

    try:
        counter = int(timestamp) // period
    except (TypeError, ValueError):
        return False

    matched = False
    for step in range(-window, window + 1):
        if counter + step < 0:
            continue
        try:
            expected = hotp(secret, counter + step, digits=digits, algorithm=algorithm)
        except ValueError:
            return False
        matched |= hmac.compare_digest(expected, candidate)
    return matched


def provisioning_uri(secret: str, account: str, issuer: str) -> str:
    """The otpauth:// URI an authenticator app scans.

    The issuer appears twice on purpose: once in the label, where older apps
    read it, and once as a parameter, where newer ones do. Apps that read both
    expect them to agree.
    """
    label = quote(f'{issuer}:{account}', safe='')
    params = '&'.join(
        [
            f'secret={quote(secret, safe="")}',
            f'issuer={quote(issuer, safe="")}',
            'algorithm=SHA1',
            f'digits={DIGITS}',
            f'period={PERIOD}',
        ]
    )
    return f'otpauth://totp/{label}?{params}'


#: Recovery codes: how many, and how long each is.
#:
#: Ten is enough to print once and cross off as they are used. Forty bits of
#: entropy each is far past what a login attempt limiter allows to be guessed,
#: and short enough to read off paper without losing your place.
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_BYTES = 5

#: No I, O, 0 or 1. These get read aloud and copied by hand.
_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    """Codes for the day the phone is gone.

    Without these, losing the authenticator means losing the account, and the
    usual way out of that is an administrator turning the whole feature off —
    which is worse than not having had it.
    """
    codes = []
    for _ in range(max(0, count)):
        raw = secrets.token_bytes(RECOVERY_CODE_BYTES)
        value = int.from_bytes(raw, 'big')
        body = ''
        for _ in range(8):
            body = _ALPHABET[value % len(_ALPHABET)] + body
            value //= len(_ALPHABET)
        codes.append(f'{body[:4]}-{body[4:]}')
    return codes


def normalize_recovery_code(code: str) -> str:
    """One spelling of a code, so hyphens and case do not decide a login."""
    return (code or '').strip().upper().replace('-', '').replace(' ', '')

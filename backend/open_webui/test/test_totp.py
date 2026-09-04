"""TOTP against the vectors RFC 6238 publishes for it.

The point of hand-rolling the algorithm was that it can be checked rather than
trusted, and this is the check. Appendix B of the RFC gives a seed, a set of
times and the code expected at each; if any of these stop matching, the
implementation is wrong and no amount of it looking right says otherwise.
"""

import base64

from open_webui.utils.totp import (
    RECOVERY_CODE_COUNT,
    generate_recovery_codes,
    generate_secret,
    normalize_recovery_code,
    provisioning_uri,
    totp,
    verify,
)

#: RFC 6238 Appendix B: the ASCII string "12345678901234567890", as base32.
RFC_SECRET = base64.b32encode(b'12345678901234567890').decode('ascii').rstrip('=')

#: Appendix B, the SHA-1 rows: (unix time, expected eight-digit code).
RFC_VECTORS = [
    (59, '94287082'),
    (1111111109, '07081804'),
    (1111111111, '14050471'),
    (1234567890, '89005924'),
    (2000000000, '69279037'),
    (20000000000, '65353130'),
]


class TestRfc6238:
    def test_matches_every_published_vector(self):
        for timestamp, expected in RFC_VECTORS:
            assert totp(RFC_SECRET, timestamp, digits=8) == expected, f'at t={timestamp}'

    def test_six_digits_are_the_last_six_of_eight(self):
        # Truncation takes the code modulo 10**digits, so the shorter form is
        # the tail of the longer one. Anything else means the modulus moved.
        for timestamp, expected in RFC_VECTORS:
            assert totp(RFC_SECRET, timestamp) == expected[-6:], f'at t={timestamp}'

    def test_the_code_holds_for_its_whole_step_and_then_changes(self):
        start = 1111111110  # a step boundary: 1111111110 / 30 is exact
        assert totp(RFC_SECRET, start) == totp(RFC_SECRET, start + 29)
        assert totp(RFC_SECRET, start) != totp(RFC_SECRET, start + 30)


class TestVerify:
    def test_accepts_the_code_for_the_moment(self):
        assert verify(RFC_SECRET, totp(RFC_SECRET, 1111111111), 1111111111)

    def test_forgives_one_step_of_clock_drift_in_each_direction(self):
        now = 1111111111
        assert verify(RFC_SECRET, totp(RFC_SECRET, now - 30), now)
        assert verify(RFC_SECRET, totp(RFC_SECRET, now + 30), now)

    def test_refuses_two_steps_away(self):
        # Widening the window widens how long an intercepted code stays useful.
        now = 1111111111
        assert not verify(RFC_SECRET, totp(RFC_SECRET, now - 60), now)
        assert not verify(RFC_SECRET, totp(RFC_SECRET, now + 60), now)

    def test_refuses_anything_that_is_not_a_code(self):
        now = 1111111111
        for candidate in ['', '   ', '12345', '1234567', 'abcdef', '12 34 56', None]:
            assert not verify(RFC_SECRET, candidate, now)

    def test_survives_a_secret_that_is_not_base32(self):
        # A stored secret can be corrupt or truncated; that is a failed login,
        # not a crashed request.
        assert not verify('not base32 !!', '123456', 1111111111)
        assert not verify('', '123456', 1111111111)

    def test_reads_a_key_the_way_someone_would_retype_it(self):
        spaced = ' '.join(RFC_SECRET[i : i + 4] for i in range(0, len(RFC_SECRET), 4))
        assert verify(spaced, totp(RFC_SECRET, 1111111111), 1111111111)
        assert verify(RFC_SECRET.lower(), totp(RFC_SECRET, 1111111111), 1111111111)


class TestSecret:
    def test_is_base32_and_usable(self):
        secret = generate_secret()
        assert secret.isalnum() and secret.isupper()
        assert len(totp(secret, 1111111111)) == 6

    def test_is_different_every_time(self):
        assert len({generate_secret() for _ in range(64)}) == 64


class TestProvisioningUri:
    def test_carries_what_an_app_needs(self):
        uri = provisioning_uri('ABC234', 'someone@example.com', 'Open WebUI')
        assert uri.startswith('otpauth://totp/')
        assert 'secret=ABC234' in uri
        assert 'issuer=Open%20WebUI' in uri
        assert 'digits=6' in uri and 'period=30' in uri and 'algorithm=SHA1' in uri

    def test_escapes_the_label_rather_than_breaking_the_uri(self):
        uri = provisioning_uri('ABC234', 'a b/c?d@example.com', 'My Fork')
        assert '/My%20Fork%3Aa%20b%2Fc%3Fd%40example.com?' in uri


class TestRecoveryCodes:
    def test_gives_the_number_asked_for(self):
        assert len(generate_recovery_codes()) == RECOVERY_CODE_COUNT
        assert len(generate_recovery_codes(3)) == 3
        assert generate_recovery_codes(0) == []
        assert generate_recovery_codes(-1) == []

    def test_avoids_the_characters_people_misread(self):
        # These get read off paper and typed back. I/O and 0/1 are where that
        # goes wrong, so they are not in the alphabet at all.
        for code in generate_recovery_codes(40):
            body = code.replace('-', '')
            assert len(body) == 8
            assert not (set(body) & set('IO01'))

    def test_reads_the_same_however_it_is_typed_back(self):
        code = generate_recovery_codes(1)[0]
        assert normalize_recovery_code(code) == code.replace('-', '')
        assert normalize_recovery_code(f'  {code.lower()}  ') == code.replace('-', '')
        assert normalize_recovery_code(code.replace('-', ' ')) == code.replace('-', '')

    def test_survives_nothing_at_all(self):
        assert normalize_recovery_code('') == ''
        assert normalize_recovery_code(None) == ''

    def test_does_not_repeat_itself(self):
        codes = generate_recovery_codes(200)
        assert len(set(codes)) == len(codes)

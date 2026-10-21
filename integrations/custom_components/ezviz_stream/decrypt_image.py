"""
Still-image (alarm snapshot) decryption.

EZVIZ encrypts stored still images - the motion/alarm snapshots behind an alarm
``picUrl`` (reference A.8.1) - with a scheme distinct from the streaming-video one
in :mod:`decrypt`. Video is AES-ECB over the first bytes of each NAL; still images
use a marker envelope + a double-MD5 password hash + AES-128-CBC with a fixed IV
(reference B.10.2). This module implements only the still-image scheme.
"""

from __future__ import annotations

from hashlib import md5

from .const import HIK_ENCRYPTION_HEADER

_HEADER_LEN = len(HIK_ENCRYPTION_HEADER)
_HASH_LEN = 32  # the on-wire password hash: ASCII-hex double-MD5 (32 chars)
_BLOCK_PREFIX = _HEADER_LEN + _HASH_LEN
_BLOCK_SIZE = 16  # AES block size (avoids importing pycryptodome for the constant)
# Fixed IV: ASCII "01234567" followed by eight NUL bytes (16 bytes total).
_IV = b"01234567" + bytes(8)
_NO_PADDING = 0


class StillImageDecryptError(Exception):
    """A still image carried the marker but could not be decrypted."""


def password_hash(password: str) -> str:
    """
    Return EZVIZ's double-MD5 hex of a verification code.

    This equals the device's ``STATUS.encryptPwd`` (reference A.5) and the hash
    embedded in an encrypted still image (reference B.10.2), so it validates a
    verification code without a frame grab.
    """
    inner = md5(password.encode(), usedforsecurity=False).hexdigest()
    return md5(inner.encode(), usedforsecurity=False).hexdigest()


def _password_hash(password: str) -> bytes:
    """Return the double-MD5 hex of the password, as the on-wire hash bytes."""
    return password_hash(password).encode()


def _key(password: str) -> bytes:
    """Return the AES key: the code NUL-padded to and truncated at 16 bytes."""
    return password.ljust(_BLOCK_SIZE, "\x00")[:_BLOCK_SIZE].encode()


def _split_blocks(data: bytes) -> list[bytes]:
    """Split concatenated ``hikencodepicture`` segments into individual blocks."""
    blocks: list[bytes] = []
    cursor = data.find(HIK_ENCRYPTION_HEADER)
    while cursor != -1 and cursor + _BLOCK_PREFIX <= len(data):
        nxt = data.find(HIK_ENCRYPTION_HEADER, cursor + _HEADER_LEN)
        end = nxt if nxt != -1 else len(data)
        blocks.append(data[cursor:end])
        cursor = nxt
    return blocks


def _decrypt_block(block: bytes, password: str) -> bytes:
    """Decrypt one block (its ``hikencodepicture`` header is at offset 0)."""
    if block[_HEADER_LEN:_BLOCK_PREFIX] != _password_hash(password):
        msg = "wrong verification code"
        raise StillImageDecryptError(msg)
    ciphertext = block[_BLOCK_PREFIX:]
    ciphertext = ciphertext[: len(ciphertext) - (len(ciphertext) % _BLOCK_SIZE)]
    if not ciphertext:
        msg = "no ciphertext after alignment"
        raise StillImageDecryptError(msg)
    # Import here (not at module load) so integration setup does not pull in
    # pycryptodome; this runs in a worker thread (api/stream call it via to_thread).
    from Crypto.Cipher import AES  # noqa: PLC0415

    plain = AES.new(_key(password), AES.MODE_CBC, _IV).decrypt(ciphertext)
    pad = plain[-1]  # PKCS#7-style: the last byte is the padding length
    return plain[:-pad] if _NO_PADDING < pad <= _BLOCK_SIZE else plain


def decrypt_still_image(data: bytes, password: str) -> bytes:
    """
    Decrypt an EZVIZ still image, or return it unchanged if it is not encrypted.

    Encrypted images carry the ``hikencodepicture`` marker (reference B.10.2); a
    plaintext image (no marker) is returned as-is. Raises StillImageDecryptError
    when the marker is present but decryption fails (e.g. a wrong verification code).
    """
    if HIK_ENCRYPTION_HEADER not in data:
        return data
    data = data[data.find(HIK_ENCRYPTION_HEADER) :]  # trim any preamble
    blocks = _split_blocks(data)
    if not blocks:
        msg = "malformed encrypted image"
        raise StillImageDecryptError(msg)
    return b"".join(_decrypt_block(block, password) for block in blocks)

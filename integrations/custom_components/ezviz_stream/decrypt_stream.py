# SPDX-License-Identifier: Apache-2.0
"""EZVIZ Image-Encryption video decryption (AES-ECB over MPEG-PS video NALs).

Our own implementation of the decryption EZVIZ applies to its cloud/SDK MPEG-PS
video when *Image Encryption* is ON. The MPEG-PS container (pack/system/PSM/PES
framing) and the Annex-B NAL start codes stay in the clear; only the first
``NAL_ENCRYPTED_PREFIX_LEN`` bytes of each **video** NAL *body* - after
``nalu_header_size`` clear codec-header bytes - are AES-ECB encrypted, with the
camera's verification code zero-padded/truncated to 16 bytes as the key (no IV).

A single NAL body can span several video PES packets, so the AES 16-byte blocks
must accumulate across PES boundaries (the container bytes between payloads are not
part of the cipher stream). ``nalu_header_size`` is ``2`` for HEVC, ``1`` for H.264
with a clear NAL header, and ``0`` for H.264 whose NAL header is itself encrypted
(the case observed on our IPC cams); :func:`detect_nalu_header_size` picks it.

We roll our own so the integration takes **no runtime dependency on pyezvizapi**
(HA core pins ``pyezvizapi==1.0.0.7``, which would clash - see doc/TODO.md). The
algorithm is derived from ``RenierM26/pyEzvizApi`` (Apache-2.0),
``pyezvizapi.stream.decrypt_hikvision_ps_video``, and is validated byte-for-byte
against it in the test suite. Runtime dependency: ``pycryptodome`` only.
"""

from __future__ import annotations

from typing import Any

MPEG_START_CODE_PREFIX = b"\x00\x00\x01"
ANNEX_B_LONG_START_CODE = b"\x00\x00\x00\x01"
NAL_ENCRYPTED_PREFIX_LEN = 4096
AES_BLOCK = 16

_PACK_HEADER = 0xBA
_SYSTEM_HEADER = 0xBB
_PROGRAM_STREAM_MAP = 0xBC
_PRIVATE_STREAM_1 = 0xBD
_PADDING = 0xBE
_PRIVATE_STREAM_2 = 0xBF


def _aes(key: bytes) -> Any:  # AES.new returns an opaque ECB cipher object
    # Imported here (not at module load) so integration setup does not pull in
    # pycryptodome; decryption runs in a worker thread (called via to_thread).
    from Crypto.Cipher import AES  # noqa: PLC0415

    return AES.new(key, AES.MODE_ECB)


def _aes_key(key: str | bytes) -> bytes:
    key_bytes = key.encode() if isinstance(key, str) else key
    return key_bytes.ljust(16, b"\0")[:16]


class Decryptor:
    """The AES-ECB primitive the EZVIZ Image-Encryption decryption is built on.

    Holds the camera key (the verification code, zero-padded/truncated to 16 bytes)
    as a single reusable ECB cipher; ECB is stateless per block, so one instance
    decrypts every NAL body in a stream. This is the only cipher in the module - the
    surrounding :func:`decrypt_ps_video` / :func:`detect_nalu_header_size` logic is
    clear MPEG-PS/NAL parsing that calls :meth:`decrypt_block` for the encrypted runs.
    """

    def __init__(self, key: str | bytes) -> None:
        """Derive the 16-byte AES key from ``key`` and build the ECB cipher once."""
        self._cipher = _aes(_aes_key(key))

    def decrypt_block(self, data: bytes) -> bytes:
        """AES-ECB-decrypt ``data`` (a whole number of 16-byte blocks)."""
        plaintext: bytes = self._cipher.decrypt(data)
        return plaintext


# --------------------------------------------------------------------------- #
# MPEG-PS stream-id classifiers + PES/packet parsing
# --------------------------------------------------------------------------- #
def _is_video_pes_stream_id(stream_id: int) -> bool:
    return 0xE0 <= stream_id <= 0xEF


def _is_metadata_stream_id(stream_id: int) -> bool:
    return stream_id in {_PACK_HEADER, _SYSTEM_HEADER, _PROGRAM_STREAM_MAP, _PADDING}


def _is_packet_start_id(stream_id: int) -> bool:
    """Return True for MPEG-PS packet start codes, excluding Annex-B NAL types."""
    return (
        stream_id
        in {
            _PACK_HEADER,
            _SYSTEM_HEADER,
            _PROGRAM_STREAM_MAP,
            _PRIVATE_STREAM_1,
            _PADDING,
            _PRIVATE_STREAM_2,
        }
        or 0xC0 <= stream_id <= 0xEF
    )


def _is_mpeg2_pack_header(data: bytes, start: int) -> bool:
    return (
        (data[start + 4] & 0xC4) == 0x44
        and (data[start + 6] & 0x04) == 0x04
        and (data[start + 8] & 0x04) == 0x04
        and (data[start + 12] & 0x01) == 0x01
        and (data[start + 13] & 0xF8) == 0xF8
    )


def _pes_payload_start(data: bytes, packet_start: int) -> int | None:
    """Payload offset for a complete-enough PES header at ``packet_start``."""
    if packet_start + 9 > len(data):
        return None
    stream_id = data[packet_start + 3]
    flags = data[packet_start + 6]
    if (flags & 0xC0) == 0x80:
        return packet_start + 9 + data[packet_start + 8]
    if 0xC0 <= stream_id <= 0xEF or stream_id == _PRIVATE_STREAM_1:
        return None
    return packet_start + 6


def _mpeg_ps_packet_end(data: bytes, start: int) -> int | None:
    """End offset of a complete MPEG-PS packet at ``start`` (else None)."""
    if start + 4 > len(data) or data[start : start + 3] != MPEG_START_CODE_PREFIX:
        return None
    stream_id = data[start + 3]
    if (
        stream_id == _PACK_HEADER
        and start + 14 <= len(data)
        and _is_mpeg2_pack_header(data, start)
    ):
        stuffing = data[start + 13] & 0x07
        candidate = start + 14 + stuffing
        return candidate if candidate <= len(data) else None
    if _is_packet_start_id(stream_id) and start + 6 <= len(data):
        packet_length = int.from_bytes(data[start + 4 : start + 6], "big")
        candidate = start + 6 + packet_length
        if packet_length and candidate <= len(data):
            if _is_video_pes_stream_id(stream_id) or stream_id == _PRIVATE_STREAM_1:
                payload_start = _pes_payload_start(data, start)
            elif 0xC0 <= stream_id <= 0xDF:
                payload_start = _pes_payload_start(data, start) or start + 6
            else:
                payload_start = start + 6
            if payload_start is not None and payload_start <= candidate:
                return candidate
    return None


def _is_zero_length_video_pes_start(data: bytes, start: int) -> bool:
    return (
        start + 9 <= len(data)
        and data[start : start + 3] == MPEG_START_CODE_PREFIX
        and _is_video_pes_stream_id(data[start + 3])
        and int.from_bytes(data[start + 4 : start + 6], "big") == 0
        and _pes_payload_start(data, start) is not None
    )


def _next_unbounded_video_pes_boundary(data: bytes, start: int) -> int | None:
    """Next packet boundary after a zero-length (unbounded) video PES payload."""
    i = start
    while i < len(data) - 3:
        if _mpeg_ps_packet_end(data, i) is not None or _is_zero_length_video_pes_start(
            data, i
        ):
            return i
        i += 1
    return None


def _video_pes_packets(data: bytes) -> list[tuple[int, int, int]]:
    """(packet_start, payload_start, packet_end) of every video PES packet, in order."""
    packets: list[tuple[int, int, int]] = []
    i = 0
    while i < len(data) - 9:
        if data[i : i + 3] != MPEG_START_CODE_PREFIX:
            i += 1
            continue
        stream_id = data[i + 3]
        if not _is_video_pes_stream_id(stream_id):
            i += 4
            continue
        pes_length = int.from_bytes(data[i + 4 : i + 6], "big")
        payload_start = _pes_payload_start(data, i)
        if payload_start is None:
            break
        packet_end = (
            i + 6 + pes_length
            if pes_length
            else _next_unbounded_video_pes_boundary(data, payload_start) or len(data)
        )
        if packet_end > len(data):
            break
        if payload_start < packet_end:
            packets.append((i, payload_start, packet_end))
        i = max(i + 4, packet_end)
    return packets


def _video_pes_payload_ranges(data: bytes) -> list[tuple[int, int]]:
    """Payload (start, end) ranges of every video PES packet, in order."""
    return [
        (payload_start, end) for _start, payload_start, end in _video_pes_packets(data)
    ]


def _first_video_start(data: bytes, start: int) -> int | None:
    """Offset of the first video-PES start code at/after ``start`` (else None).

    Safe against false start codes inside encrypted payloads: it is only ever called
    over a region whose leading bytes are container (pack/audio) up to the first video
    packet start, and it returns at that first hit without scanning into any payload.
    """
    i = start
    while i + 4 <= len(data):
        if data[i : i + 3] == MPEG_START_CODE_PREFIX and _is_video_pes_stream_id(
            data[i + 3]
        ):
            return i
        i += 1
    return None


def _last_run_boundary(data: bytes) -> int:
    """Offset where the last (possibly still-open) video-PES run begins.

    ``decrypt_ps_video`` decrypts consecutive video-PES payloads as one "run" and
    resets its AES state when a non-video PES packet interrupts them. Everything before
    the last run therefore decrypts identically whether or not more bytes arrive, so a
    streaming decryptor can safely emit up to here and buffer the (still-growing) last
    run - including any incomplete trailing video packet. Returns ``len(data)`` only
    when there is no video PES at all (pure container, safe to emit).
    """
    packets = _video_pes_packets(data)
    if not packets:
        # No complete video packet: buffer from the first (incomplete) video start.
        # If none is visible yet, emit all but the last 3 bytes, which could be the
        # leading "00 00 01" of a video start code whose stream-id byte hasn't arrived.
        first = _first_video_start(data, 0)
        return max(0, len(data) - 3) if first is None else first
    last_run_start = packets[0][0]
    prev_end = packets[0][2]
    for packet_start, _payload_start, packet_end in packets[1:]:
        if _has_non_video_pes_packet(data, prev_end, packet_start):
            last_run_start = packet_start
        prev_end = packet_end
    # A video packet may be starting past the last complete one; if a non-video PES
    # closed the last complete run first, that run is done and the trailing (incomplete)
    # packet begins the new open run - buffer from there instead.
    trailing = _first_video_start(data, prev_end)
    if trailing is not None and _has_non_video_pes_packet(data, prev_end, trailing):
        return trailing
    return last_run_start


def _last_complete_packet_end(data: bytes) -> int:
    """End offset of the last complete MPEG-PS packet, 0 if none (safety valve)."""
    end = i = 0
    while i < len(data) - 3:
        if data[i : i + 3] != MPEG_START_CODE_PREFIX:
            i += 1
            continue
        packet_end = _mpeg_ps_packet_end(data, i)
        if packet_end is None:
            i += 1
            continue
        end = i = packet_end
    return end


def _has_non_video_pes_packet(data: bytes, start: int, end: int) -> bool:
    """Return True when a non-video PES packet appears in ``data[start:end]``."""
    i = start
    while i < end - 3:
        if data[i : i + 3] != MPEG_START_CODE_PREFIX:
            i += 1
            continue
        stream_id = data[i + 3]
        if _is_metadata_stream_id(stream_id):
            i += 4
            continue
        if _is_packet_start_id(stream_id) and not _is_video_pes_stream_id(stream_id):
            return True
        i += 4
    return False


# --------------------------------------------------------------------------- #
# Annex-B NAL scanning + header plausibility (used to reject ciphertext that
# accidentally contains 00 00 01, which would shift AES block alignment)
# --------------------------------------------------------------------------- #
def _find_nal_start_codes(data: bytes, start: int, end: int) -> list[tuple[int, int]]:
    positions: list[tuple[int, int]] = []
    i = start
    while i < end - 3:
        if data[i : i + 4] == ANNEX_B_LONG_START_CODE:
            positions.append((i, 4))
            i += 4
        elif data[i : i + 3] == MPEG_START_CODE_PREFIX:
            positions.append((i, 3))
            i += 3
        else:
            i += 1
    return positions


def _h264_nal_type(data: bytes, pos: int, length: int) -> int | None:
    header_pos = pos + length
    if header_pos >= len(data):
        return None
    return data[header_pos] & 0x1F


def _hevc_nal_type(data: bytes, pos: int, length: int) -> int | None:
    header_pos = pos + length
    if header_pos + 1 >= len(data):
        return None
    return (data[header_pos] >> 1) & 0x3F


def _find_h264_nal_start_codes(
    data: bytes, start: int, end: int
) -> list[tuple[int, int]]:
    return [
        (pos, length)
        for pos, length in _find_nal_start_codes(data, start, end)
        if (t := _h264_nal_type(data, pos, length)) is not None and 1 <= t <= 23
    ]


def _find_hevc_nal_start_codes(
    data: bytes, start: int, end: int
) -> list[tuple[int, int]]:
    return [
        (pos, length)
        for pos, length in _find_nal_start_codes(data, start, end)
        if (t := _hevc_nal_type(data, pos, length)) is not None and t <= 40
    ]


def _is_plausible_hevc_header(data: bytes, pos: int, length: int) -> bool:
    header_pos = pos + length
    if header_pos + 1 >= len(data):
        return False
    if (data[header_pos] & 0x80) != 0:
        return False
    nal_type = (data[header_pos] >> 1) & 0x3F
    layer_id = ((data[header_pos] & 0x01) << 5) | (data[header_pos + 1] >> 3)
    return nal_type <= 40 and layer_id == 0 and (data[header_pos + 1] & 0x07) != 0


def _is_plausible_h264_header(data: bytes, pos: int, length: int) -> bool:
    header_pos = pos + length
    if header_pos >= len(data):
        return False
    nal_header = data[header_pos]
    return (nal_header & 0x80) == 0 and 1 <= (nal_header & 0x1F) <= 23


def _is_plausible_hevc_header_bytes(header: bytes) -> bool:
    if len(header) < 2:
        return False
    forbidden_zero = header[0] & 0x80 == 0
    layer_id = ((header[0] & 0x01) << 5) | (header[1] >> 3)
    temporal_id_plus1 = header[1] & 0x07
    nal_type = (header[0] >> 1) & 0x3F
    return forbidden_zero and layer_id == 0 and temporal_id_plus1 > 0 and nal_type <= 40


def _h264_header_score(nal_type: int) -> int:
    if nal_type in {1, 5, 7, 8}:
        return 4
    if nal_type in {2, 3, 4}:
        return 2
    return 1


def _hevc_header_score(nal_type: int) -> int:
    if nal_type in {32, 33, 34}:
        return 4
    if nal_type < 32:
        return 2
    return 1


def detect_nalu_header_size(
    data: bytes, key: str | bytes, *, default: int | None = 2
) -> int | None:
    """Detect clear codec-header bytes to preserve before AES: 2=HEVC, 1=H.264
    clear header, 0=H.264 encrypted header. ``default`` if no video NAL evidence."""
    decryptor = Decryptor(key)
    scores = {"hevc": 0, "hevc-encrypted-header": 0, "h264-clear-header": 0, "h264": 0}
    for payload_start, payload_end in _video_pes_payload_ranges(data):
        for pos, length in _find_nal_start_codes(data, payload_start, payload_end):
            header_pos = pos + length
            if _is_plausible_hevc_header(data, pos, length):
                scores["hevc"] += _hevc_header_score((data[header_pos] >> 1) & 0x3F)
            if _is_plausible_h264_header(data, pos, length):
                scores["h264-clear-header"] += _h264_header_score(
                    data[header_pos] & 0x1F
                )
            if header_pos + AES_BLOCK <= payload_end:
                decrypted = decryptor.decrypt_block(
                    bytes(data[header_pos : header_pos + AES_BLOCK])
                )
                first = decrypted[0]
                if _is_plausible_hevc_header_bytes(decrypted[:2]):
                    scores["hevc-encrypted-header"] += _hevc_header_score(
                        (decrypted[0] >> 1) & 0x3F
                    )
                if (first & 0x80) == 0 and 1 <= (first & 0x1F) <= 23:
                    scores["h264"] += _h264_header_score(first & 0x1F)
    if not any(scores.values()):
        return default
    if (
        scores["hevc-encrypted-header"] > scores["hevc"]
        and scores["hevc-encrypted-header"] >= scores["h264"]
        and scores["hevc-encrypted-header"] >= scores["h264-clear-header"]
    ):
        return 0
    if scores["h264"] > scores["hevc"] and scores["h264"] > scores["h264-clear-header"]:
        return 0
    if scores["h264-clear-header"] > scores["hevc"]:
        return 1
    return 2


# --------------------------------------------------------------------------- #
# Decryption
# --------------------------------------------------------------------------- #
def decrypt_ps_video(
    data: bytes, key: str | bytes, *, nalu_header_size: int | None = None
) -> bytes:
    """Decrypt EZVIZ Image-Encryption MPEG-PS video and return the clear stream.

    ``nalu_header_size`` None => auto-detect (:func:`detect_nalu_header_size`).
    """
    if nalu_header_size is None:
        nalu_header_size = detect_nalu_header_size(data, key)
    if nalu_header_size is None:
        nalu_header_size = 2
    if nalu_header_size < 0:
        raise ValueError("nalu_header_size must be non-negative")

    decryptor = Decryptor(key)

    def find_nal_start_codes(buf: bytes, start: int, end: int) -> list[tuple[int, int]]:
        if nalu_header_size == 1:
            return _find_h264_nal_start_codes(buf, start, end)
        if nalu_header_size == 2:
            return _find_hevc_nal_start_codes(buf, start, end)
        # header itself encrypted (0): a real start code precedes an AES block that
        # decrypts to a plausible NAL header.
        out: list[tuple[int, int]] = []
        for pos, length in _find_nal_start_codes(buf, start, end):
            header = pos + length
            if header + AES_BLOCK > end:
                continue
            dec = decryptor.decrypt_block(bytes(buf[header : header + AES_BLOCK]))
            t = dec[0] & 0x1F
            if _is_plausible_hevc_header_bytes(dec[:2]) or (
                (dec[0] & 0x80) == 0 and 1 <= t <= 23
            ):
                out.append((pos, length))
        return out

    def decrypt_video_payload_run(payload: bytes) -> bytes:
        payload_output = bytearray(payload)
        pending_positions: list[int] = []
        pending_block = bytearray()
        active_nal = False
        active_nal_decrypted = active_nal_body_start = 0

        def reset() -> None:
            nonlocal active_nal, active_nal_body_start, active_nal_decrypted
            pending_positions.clear()
            pending_block.clear()
            active_nal = False
            active_nal_decrypted = active_nal_body_start = 0

        def decrypt_segment(start: int, end: int) -> None:
            nonlocal active_nal_decrypted
            if end <= start:
                return
            remaining = NAL_ENCRYPTED_PREFIX_LEN - active_nal_decrypted
            if remaining <= 0:
                return
            decrypt_end = min(end, start + remaining)
            for pos in range(start, decrypt_end):
                pending_positions.append(pos)
                pending_block.append(payload_output[pos])
                active_nal_decrypted += 1
                if len(pending_block) != AES_BLOCK:
                    continue
                dec = decryptor.decrypt_block(bytes(pending_block))
                for block_pos, dec_byte in zip(pending_positions, dec, strict=True):
                    payload_output[block_pos] = dec_byte
                pending_positions.clear()
                pending_block.clear()

        def starts_plausible_encrypted_nal(start: int, end: int) -> bool:
            if end - start < AES_BLOCK:
                return False
            dec = decryptor.decrypt_block(
                bytes(payload_output[start : start + AES_BLOCK])
            )
            t = dec[0] & 0x1F
            return _is_plausible_hevc_header_bytes(dec[:2]) or (1 <= t <= 23)

        def is_post_prefix_tail_lookalike(pos: int, length: int) -> bool:
            if nalu_header_size == 1:
                t = _h264_nal_type(payload, pos, length)
                return t is None or not 1 <= t <= 5
            t = _hevc_nal_type(payload, pos, length)
            return t is None or t >= 32

        nal_starts = find_nal_start_codes(payload, 0, len(payload))
        segment_start = 0
        for idx, (pos, length) in enumerate(nal_starts):
            decrypt_end = (
                nal_starts[idx + 1][0] if idx + 1 < len(nal_starts) else len(payload)
            )
            if active_nal:
                candidate = active_nal_decrypted + max(0, pos - segment_start)
                if candidate < NAL_ENCRYPTED_PREFIX_LEN:
                    if nalu_header_size == 0 and (
                        candidate == 0
                        or not starts_plausible_encrypted_nal(pos + length, decrypt_end)
                    ):
                        continue
                    if nalu_header_size != 0 and candidate == 0:
                        continue
            if (
                active_nal
                and active_nal_decrypted >= NAL_ENCRYPTED_PREFIX_LEN
                and pos > active_nal_body_start + NAL_ENCRYPTED_PREFIX_LEN
                and (
                    (
                        nalu_header_size == 0
                        and not starts_plausible_encrypted_nal(
                            pos + length, decrypt_end
                        )
                    )
                    or (
                        nalu_header_size != 0
                        and is_post_prefix_tail_lookalike(pos, length)
                    )
                )
            ):
                continue
            if active_nal and segment_start < pos:
                decrypt_segment(segment_start, pos)
            reset()
            active_nal = True
            decrypt_start = pos + length + nalu_header_size
            active_nal_body_start = decrypt_start
            decrypt_segment(decrypt_start, decrypt_end)
            segment_start = decrypt_end
        if active_nal and segment_start < len(payload):
            decrypt_segment(segment_start, len(payload))
        return bytes(payload_output)

    output = bytearray(data)
    run_offsets: list[int] = []
    run_bytes = bytearray()

    def flush_run() -> None:
        if not run_bytes:
            return
        decrypted = decrypt_video_payload_run(bytes(run_bytes))
        for out_pos, dec_byte in zip(run_offsets, decrypted, strict=True):
            output[out_pos] = dec_byte
        run_offsets.clear()
        run_bytes.clear()

    previous_video_end: int | None = None
    for payload_start, payload_end in _video_pes_payload_ranges(data):
        if previous_video_end is not None and _has_non_video_pes_packet(
            data, previous_video_end, payload_start
        ):
            flush_run()
        for out_pos in range(payload_start, payload_end):
            run_offsets.append(out_pos)
            run_bytes.append(data[out_pos])
        previous_video_end = payload_end
    flush_run()
    return bytes(output)


# --------------------------------------------------------------------------- #
# Audio (AAC) payload decryption
# --------------------------------------------------------------------------- #
# EZVIZ encrypts audio like video: the ADTS framing header stays clear and the AAC
# frame body after it is AES-ECB encrypted with the same key. Verified against a
# validated key (video decrypts cleanly with it) - reference
# scripts/in/EzViz_Capture_Replay_SD_Unec_Enc.pcapng (0 decode errors over 657 frames).
_ADTS_SYNC = 0xFF
_ADTS_HEADER_LEN = 7  # protection_absent=1 (no CRC); 9 bytes when a CRC is present


def _adts_header_len(frame: bytes) -> int:
    """ADTS header length: 7 bytes normally, 9 when the CRC-present bit is clear."""
    return _ADTS_HEADER_LEN if len(frame) >= 2 and frame[1] & 0x01 else 9


def _audio_pes_payloads(data: bytes) -> list[tuple[int, int]]:
    """(payload_start, payload_end) of each audio PES packet (stream 0xC0-0xDF).

    Advances over each PES by its length so it never scans *into* a video payload
    (whose Annex-B NAL start codes could otherwise be misread as PES starts).
    """
    out: list[tuple[int, int]] = []
    i = 0
    while i < len(data) - 6:
        if data[i : i + 3] != MPEG_START_CODE_PREFIX:
            i += 1
            continue
        stream_id = data[i + 3]
        if stream_id == _PACK_HEADER:
            i += 14  # MPEG-2 pack header (+ stuffing handled by resync below)
            continue
        if 0xC0 <= stream_id <= 0xEF or stream_id == _PRIVATE_STREAM_1:
            pes_length = int.from_bytes(data[i + 4 : i + 6], "big")
            end = i + 6 + pes_length
            if pes_length and end <= len(data):
                if 0xC0 <= stream_id <= 0xDF:  # audio
                    payload_start = _pes_payload_start(data, i) or (i + 6)
                    if payload_start < end:
                        out.append((payload_start, end))
                i = end  # skip the whole packet (video included)
                continue
        i += 1
    return out


def decrypt_ps_audio(data: bytes, key: str | bytes) -> bytes:
    """Return ``data`` with each audio PES's AAC body decrypted (ADTS header clear).

    Each audio PES carries one ADTS AAC frame; the body after the ADTS header is
    AES-ECB encrypted (whole 16-byte blocks; a trailing partial block stays clear).
    Non-ADTS payloads are left untouched. Video PES are not touched (see
    :func:`decrypt_ps_video`).
    """
    decryptor = Decryptor(key)
    out = bytearray(data)
    for start, end in _audio_pes_payloads(data):
        frame = out[start:end]
        if not frame or frame[0] != _ADTS_SYNC:
            continue
        header = _adts_header_len(bytes(frame))
        enc = ((len(frame) - header) // AES_BLOCK) * AES_BLOCK
        if enc > 0:
            clear = decryptor.decrypt_block(bytes(frame[header : header + enc]))
            out[start + header : start + header + enc] = clear
    return bytes(out)


# --------------------------------------------------------------------------- #
# Streaming decryption (continuous IPC live view)
# --------------------------------------------------------------------------- #
_DETECT_MIN_BYTES = 64 * 1024  # buffer this much before auto-detecting nalu_header_size
_MAX_STREAM_BUFFER = 16 * 1024 * 1024  # safety valve if no run boundary ever appears


class StreamingPsDecryptor:
    """Incrementally decrypt an EZVIZ Image-Encryption MPEG-PS byte stream.

    Feed arbitrary byte chunks; each :meth:`feed` returns the bytes that are now safe
    to emit - complete video-PES runs, whose decryption cannot change once later bytes
    arrive - and buffers the still-open last run. :meth:`flush` decrypts and returns
    whatever remains. The concatenation of every output equals :func:`decrypt_ps_video`
    over the concatenated input, so it is validated against that one-shot oracle.

    ``nalu_header_size`` is auto-detected once (it is stable per camera) after
    ``_DETECT_MIN_BYTES`` have accumulated, then reused for the whole stream.

    With ``decrypt_audio`` the emitted bytes also have their AAC audio decrypted (see
    :func:`decrypt_ps_audio`); the default is video-only, which keeps the output equal
    to :func:`decrypt_ps_video` for the oracle test.
    """

    def __init__(
        self,
        key: str | bytes,
        *,
        nalu_header_size: int | None = None,
        decrypt_audio: bool = False,
    ) -> None:
        """Start with an empty buffer; detect the header size lazily if not given."""
        self._key = key
        self._nalu_header_size = nalu_header_size
        self._buf = bytearray()
        self._decrypt_audio = decrypt_audio

    def feed(self, chunk: bytes) -> bytes:
        """Add ``chunk`` and return any now-safe decrypted bytes (may be empty)."""
        self._buf += chunk
        return self._drain(final=False)

    def flush(self) -> bytes:
        """Decrypt and return whatever remains buffered (call at end of stream)."""
        return self._drain(final=True)

    def _drain(self, *, final: bool) -> bytes:
        if self._nalu_header_size is None and (
            final or len(self._buf) >= _DETECT_MIN_BYTES
        ):
            self._nalu_header_size = detect_nalu_header_size(
                bytes(self._buf), self._key
            )
        if self._nalu_header_size is None and not final:
            return b""  # not enough evidence to detect the header size yet

        if final:
            cut = len(self._buf)
        else:
            cut = _last_run_boundary(bytes(self._buf))
            if cut <= 0:
                if len(self._buf) < _MAX_STREAM_BUFFER:
                    return b""
                cut = _last_complete_packet_end(bytes(self._buf))  # safety valve
                if cut <= 0:
                    return b""
        if cut <= 0:
            return b""

        prefix = bytes(self._buf[:cut])
        del self._buf[:cut]
        nalu_header_size = (
            self._nalu_header_size if self._nalu_header_size is not None else 2
        )
        result = decrypt_ps_video(prefix, self._key, nalu_header_size=nalu_header_size)
        if self._decrypt_audio:
            result = decrypt_ps_audio(result, self._key)
        return result

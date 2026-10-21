"""EZVIZ VTM/VTDU ``ysproto`` media protocol - pure, I/O-free logic.

Everything here is byte-in/byte-out (no sockets): the 8-byte frame framing, the
minimal protobuf used by StreamInfoReq/Rsp, the StreamInfoReq/KeepAlive builders and
stream-URL helpers, RTP/RFC-7798 HEVC de-packetisation (spec §4.1 - the proven core
contribution), and channel-0x01 transport detection. The socket driver that uses
these lives in the streaming client (added with the producer).
"""

from __future__ import annotations

import re
import struct
from typing import Any

# --- framing (reference.md B.1) --------------------------------------------- #
MAGIC = 0x24
HEADER_SIZE = 8
CH_MSG = 0x00  # control channel
CH_STREAM = 0x01  # media channel

# --- message codes (reference.md B.3) --------------------------------------- #
MSG_STREAMINFO_REQ = 0x13B
MSG_STREAMINFO_RSP = 0x13C
MSG_KEEPALIVE_REQ = 0x132

# --- misc ------------------------------------------------------------------- #
ANNEX_B_START_CODE = b"\x00\x00\x00\x01"
VERSION_TAG = "v3.6.3.20221124"  # StreamInfoReq protobuf fields 3 & 6 (spec §3)
CLIENT_TYPE = "9"  # desktop/Studio persona used in the stream URL


# --------------------------------------------------------------------------- #
# Minimal protobuf (reference.md B.5)
# --------------------------------------------------------------------------- #
def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _read_varint(data: bytes, i: int) -> tuple[int, int]:
    shift = result = 0
    while True:
        b = data[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, i
        shift += 7


def decode_protobuf(data: bytes) -> dict[int, list[Any]]:
    """Decode a flat protobuf message into {field_number: [values]}."""
    fields: dict[int, list[Any]] = {}
    i = 0
    val: Any  # a varint int (wire 0) or the raw bytes of a length/fixed field
    while i < len(data):
        try:
            tag, i = _read_varint(data, i)
            fn, wire = tag >> 3, tag & 7
            if wire == 0:
                val, i = _read_varint(data, i)
            elif wire == 2:
                ln, i = _read_varint(data, i)
                val, i = data[i : i + ln], i + ln
            elif wire == 5:
                val, i = data[i : i + 4], i + 4
            elif wire == 1:
                val, i = data[i : i + 8], i + 8
            else:
                break
        except IndexError:
            break
        fields.setdefault(fn, []).append(val)
    return fields


def field_str(fields: dict[int, list[Any]], fn: int) -> str | None:
    """Return field ``fn`` decoded as UTF-8 text, or None."""
    vals = fields.get(fn)
    if not vals or not isinstance(vals[0], bytes | bytearray):
        return None
    try:
        return vals[0].decode()
    except UnicodeDecodeError:
        return None


def _pb_string(fn: int, s: str) -> bytes:
    data = s.encode()
    return bytes([(fn << 3) | 2]) + _varint(len(data)) + data


def encode_streaminforeq(stream_url: str, vtm_stream_key: str | None) -> bytes:
    """Build a StreamInfoReq body (1=url, 2=vtmkey?, 3/6=version, 4=proxytype)."""
    body = _pb_string(1, stream_url)
    if vtm_stream_key is not None:
        body += _pb_string(2, vtm_stream_key)
    body += _pb_string(3, VERSION_TAG)
    body += bytes([(4 << 3) | 0]) + _varint(0)  # field 4 int32 = 0
    body += _pb_string(6, VERSION_TAG)
    return body


# --------------------------------------------------------------------------- #
# Frame framing
# --------------------------------------------------------------------------- #
def build_frame(channel: int, msgcode: int, body: bytes, *, seq: int = 0) -> bytes:
    """Wrap ``body`` in the 8-byte ysproto header."""
    return struct.pack(">BBHHH", MAGIC, channel, len(body), seq, msgcode) + body


def read_frame(buf: bytes) -> tuple[tuple[int, int, bytes] | None, int]:
    """Extract the first complete frame from ``buf``.

    Returns ``(frame, consumed)`` where ``frame`` is ``(channel, msgcode, body)`` or
    None if no complete frame is present yet, and ``consumed`` is the number of
    leading bytes the caller should drop (skipped garbage + the whole frame).
    """
    start = buf.find(bytes([MAGIC]))
    if start < 0:
        return None, len(buf)  # no magic anywhere - discard
    if len(buf) - start < HEADER_SIZE:
        return None, start  # keep the partial header
    _, channel, length, _seq, msgcode = struct.unpack(
        ">BBHHH", buf[start : start + HEADER_SIZE]
    )
    end = start + HEADER_SIZE + length
    if len(buf) < end:
        return None, start  # keep the partial body
    return (channel, msgcode, buf[start + HEADER_SIZE : end]), end


def build_streaminfo_request(
    stream_url: str, vtm_stream_key: str | None = None
) -> bytes:
    """Return a ready-to-send StreamInfoReq frame."""
    return build_frame(
        CH_MSG, MSG_STREAMINFO_REQ, encode_streaminforeq(stream_url, vtm_stream_key)
    )


def build_keepalive(stream_ssn: str, *, seq: int = 0) -> bytes:
    """Return a ready-to-send KeepAlive frame.

    The body is the StreamInfoRsp ``streamssn`` wrapped as protobuf field 1 - exactly
    what the official client sends (verified by packet capture). Sending the raw
    string instead makes the VTDU FIN the connection ~0.2 s later, which caused the
    ~5.5 s session churn (heavy live-view buffering and the day/night flip). The
    official client also increments ``seq`` per keepalive.
    """
    return build_frame(CH_MSG, MSG_KEEPALIVE_REQ, _pb_string(1, stream_ssn), seq=seq)


# --------------------------------------------------------------------------- #
# Stream URL
# --------------------------------------------------------------------------- #
def build_stream_url(
    ip: str,
    port: int,
    serial: str,
    channel: int,
    token: str,
    *,
    stream: int = 1,
    biz: str = "",
    timestamp_ms: int | None = None,
    time_range: tuple[str, str] | None = None,
) -> str:
    """Build a ysproto stream URL. ``stream`` selects the track (1=main, 2=sub).

    ``timestamp_ms`` (epoch ms) is appended as ``&timestamp=`` when given - the
    proven client sends it, and the VTM echoes the query into the VTDU redirect.
    ``time_range`` (``(begin, end)`` CAS timestamps) switches the path to ``/playback``
    for SD-card recordings; without it the URL is a ``/live`` request (reference:
    scripts/in/EzViz_Capture_Replay_SD.pcapng).
    """
    biz_part = f"&{biz}" if biz else ""
    ts_part = f"&timestamp={timestamp_ms}" if timestamp_ms is not None else ""
    if time_range is not None:
        begin, end = time_range
        return (
            f"ysproto://{ip}:{port}/playback?"
            f"dev={serial}&chn={channel}&stream={stream}"
            f"&begin={begin}&end={end}&serial={serial}&streamtag=NULL"
            f"&cln={CLIENT_TYPE}&isp=0&auth=1&ssn={token}{biz_part}&vip=0&a=1{ts_part}"
        )
    return (
        f"ysproto://{ip}:{port}/live?"
        f"dev={serial}&chn={channel}&stream={stream}&cln={CLIENT_TYPE}"
        f"&isp=0&auth=1&ssn={token}{biz_part}&vip=0{ts_part}"
    )


def set_stream_param(url: str, stream: int) -> str:
    """Force the ``stream=`` index in a ysproto live URL (main/sub propagation)."""
    return re.sub(r"stream=\d+", f"stream={stream}", url, count=1)


def scan_ysproto(body: bytes) -> str | None:
    """Recover a ``ysproto://…`` URL embedded in a StreamInfoRsp body."""
    idx = body.find(b"ysproto://")
    if idx < 0:
        return None
    end = idx
    while end < len(body) and 0x20 <= body[end] < 0x7F:
        end += 1
    return body[idx:end].decode()


# --------------------------------------------------------------------------- #
# Transport detection + RTP/RFC-7798 HEVC de-packetiser (spec §4.1)
# --------------------------------------------------------------------------- #
def detect_transport(body: bytes) -> str:
    """Detect the channel-0x01 container from its first bytes (spec §4)."""
    if body[:4] == b"\x00\x00\x01\xba":
        return "mpeg-ps"
    if body and body[0] == 0x47:
        return "mpeg-ts"
    if body and (body[0] >> 6) == 2:  # RTP version 2
        return "rtp"
    return "unknown"


_RTP_VERSION = 2
_HEVC_PAYLOAD_TYPE = 96
_NAL_TYPE_AP = 48  # aggregation packet
_NAL_TYPE_FU = 49  # fragmentation unit


class HevcDepacketizer:
    """Reassemble Annex-B HEVC from channel-0x01 RTP packets (RFC-7798).

    Feed each RTP packet body to :meth:`push`; it returns any complete NAL unit(s)
    prefixed with the Annex-B start code (empty bytes when a fragment is still being
    assembled). Fragmentation-unit (FU) state is held across calls.
    """

    def __init__(self) -> None:
        """Start with no fragmentation-unit in progress."""
        self._fu: bytes | None = None

    def push(self, body: bytes) -> bytes:
        """Depacketise one RTP packet body into Annex-B HEVC (may be empty)."""
        if len(body) < 14 or (body[0] >> 6) != _RTP_VERSION:
            return b""
        if (body[1] & 0x7F) != _HEVC_PAYLOAD_TYPE:
            return b""
        cc = body[0] & 0x0F
        ext = (body[0] >> 4) & 1
        off = 12 + cc * 4
        if ext:
            if len(body) < off + 4:
                return b""
            extlen = int.from_bytes(body[off + 2 : off + 4], "big")
            off += 4 + extlen * 4
        payload = body[off:]
        if len(payload) < 3:
            return b""

        nal_type = (payload[0] >> 1) & 0x3F
        if nal_type < _NAL_TYPE_AP:  # single NAL unit
            return ANNEX_B_START_CODE + payload
        if nal_type == _NAL_TYPE_AP:
            return self._aggregation(payload)
        if nal_type == _NAL_TYPE_FU:
            return self._fragmentation(payload)
        return b""

    def _aggregation(self, payload: bytes) -> bytes:
        out, i = b"", 2
        while i + 2 <= len(payload):
            size = int.from_bytes(payload[i : i + 2], "big")
            i += 2
            out += ANNEX_B_START_CODE + payload[i : i + size]
            i += size
        return out

    def _fragmentation(self, payload: bytes) -> bytes:
        fu_header = payload[2]
        start = fu_header >> 7
        end = (fu_header >> 6) & 1
        frag_type = fu_header & 0x3F
        frag = payload[3:]
        if start:  # rebuild the two-byte NAL header, then the first fragment
            b0 = (payload[0] & 0x81) | (frag_type << 1)
            self._fu = bytes([b0, payload[1]]) + frag
        elif self._fu is not None:
            self._fu += frag
        if end and self._fu is not None:
            nal, self._fu = self._fu, None
            return ANNEX_B_START_CODE + nal
        return b""

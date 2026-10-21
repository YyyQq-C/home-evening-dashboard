"""
EZVIZ cloud-replay client: stream a stored clip from the cloud replay server.

A distinct protocol from the live VTM/VTDU ``ysproto`` path (see :mod:`stream`): a
TLS socket carrying 32-byte-framed XML control messages plus binary media. The
media payload is encrypted MPEG-PS, decrypted on the fly with the camera
verification code by the same :class:`~.decrypt.StreamingPsDecryptor` the live IPC
path uses.

The wire protocol is ported from pyEzvizApi
(``pyezvizapi.stream.download_ezviz_cloud_replay`` and friends) - see NOTICE. The
socket loop is blocking (stdlib ``socket``/``ssl`` only, no new runtime
dependency), so :func:`iter_cloud_replay_ps` runs it in a worker thread and bridges
decrypted chunks to the event loop through a bounded queue (which backpressures the
socket thread when a consumer is slow). Unlike the reference, which buffers the
whole clip before decrypting, we decrypt and emit incrementally so playback can
start immediately and memory stays bounded.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import queue
import re
import socket
import ssl
import struct
import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from .decrypt_stream import StreamingPsDecryptor

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

_LOGGER = logging.getLogger(__name__)

# --- wire protocol constants (reference: pyezvizapi.stream) ------------------ #
_MAGIC = 0x9EBAACE9
_OPEN_CMD = 0x5003
_HEARTBEAT_CMD = 0x5010
_FRAME_HEADER = struct.Struct(">IIIIIIII")  # magic, ver=1, seq, 0, cmd, 0, len, 0
_FRAME_VERSION = 1
_MD5_HEX_LEN = 32
_XML_PREFIX = b"<?xml"
_XML_END = re.compile(rb"</(?:Request|Response)>")
# A server message's <Type> value: media payload vs end-of-stream.
_DATA_TYPES_MEDIA = (0, 1, 2)
_DATA_TYPE_EOF = 100

# --- timing / buffering ------------------------------------------------------ #
_CONNECT_TIMEOUT = 30.0
_READ_TIMEOUT = 2.0  # recv timeout, so the loop can re-check the stop flag
_HEARTBEAT_INTERVAL = 5.0
_RECV_SIZE = 8192
_QUEUE_MAX = 256  # decrypted chunks buffered between the socket thread and the loop
_JOIN_TIMEOUT = 5.0


class CloudReplayError(Exception):
    """The cloud-replay server rejected the request or the stream failed."""


class _Stopped(Exception):  # noqa: N818 - internal control signal, not an error
    """Raised inside the worker when the consumer asked it to stop."""


class _SocketClosed(Exception):  # noqa: N818 - internal control signal, not an error
    """Raised when the peer closes the socket - the server's end-of-stream signal."""


class _ReplaySocket(Protocol):
    """The socket surface the replay loop needs (real ssl socket, or a test fake)."""

    def sendall(self, data: bytes, /) -> None:
        """Send all of ``data``."""

    def recv(self, bufsize: int, /) -> bytes:
        """Read up to ``bufsize`` bytes (empty bytes on a clean close)."""

    def close(self) -> None:
        """Close the socket."""


@dataclass(frozen=True, slots=True)
class _Message:
    """A decoded server message: its XML header, media ``data``, and status fields."""

    data: bytes
    md5_ok: bool
    result: int | None
    err_code: int | None
    data_type: int | None


def _md5_hex(data: bytes) -> bytes:
    """Return the EZVIZ protocol MD5 (integrity, not security) as lowercase hex."""
    return hashlib.md5(data, usedforsecurity=False).hexdigest().encode()


def _frame(payload: bytes, *, sequence: int, command: int) -> bytes:
    """Wrap an XML control payload in the 32-byte frame header + trailing MD5."""
    header = _FRAME_HEADER.pack(
        _MAGIC, _FRAME_VERSION, sequence, 0, command, 0, len(payload), 0
    )
    return header + payload + _md5_hex(payload)


def _parse_stream_url(stream_url: str) -> tuple[str, int]:
    """Split an EZVIZ ``host:port`` replay stream URL into its parts."""
    host, sep, port_text = stream_url.partition(":")
    if not host or sep != ":" or not port_text.isdigit():
        msg = f"invalid cloud-replay streamUrl: {stream_url!r}"
        raise CloudReplayError(msg)
    return host, int(port_text)


def _build_open_xml(  # noqa: PLR0913 - the open request needs the full clip descriptor
    *,
    ticket: str,
    serial: str,
    channel: int,
    seq_id: str | int,
    begin_cas: str,
    end_cas: str,
    storage_version: int,
    video_type: int,
) -> bytes:
    """Build the ``<Request>`` payload that opens a cloud-storage clip for playback."""
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<Request>\n"
        "\t<Authorization></Authorization>\n"
        "\t<Session></Session>\n"
        f"\t<Token>{ticket}</Token>\n"
        "\t<FrontType>2</FrontType>\n"
        "\t<PlayType>2</PlayType>\n"
        "\t<BusType>2</BusType>\n"
        "\t<FileInfo>\n"
        "\t\t<FileType>1</FileType>\n"
        f'\t\t<File StorageVersion="{storage_version}" Id="{seq_id}" />\n'
        f"\t\t<VideoType>{video_type}</VideoType>\n"
        f'\t\t<Time Begin="{begin_cas}" End="{end_cas}" />\n'
        f'\t\t<CameraInfo SubSerial="{serial}_{channel}" ChannelNo="{channel}" />\n'
        "\t\t<InterlaceFlag>0</InterlaceFlag>\n"
        "\t</FileInfo>\n"
        "\t<ClientType>3</ClientType>\n"
        "\t<PlaySpeed>0</PlaySpeed>\n"
        "</Request>\n"
    ).encode()


def _heartbeat_xml() -> bytes:
    """Build the periodic keep-alive (HB) response the server expects."""
    return (
        b'<?xml version="1.0" encoding="utf-8"?>\n'
        b"<Response>\n"
        b"\t<Result>0</Result>\n"
        b"\t<Command>HB</Command>\n"
        b"</Response>\n"
    )


def _xml_int(xml: bytes, tag: bytes) -> int | None:
    """Return the integer text of ``<tag>N</tag>`` in ``xml``, or None if absent."""
    match = re.search(rb"<" + tag + rb"(?: [^>]*)?>(-?\d+)</" + tag + rb">", xml)
    return int(match.group(1)) if match else None


def _xml_attr_int(xml: bytes, tag: bytes, attr: bytes) -> int | None:
    """Return ``<tag attr="N" ...>`` as an int, or None if absent."""
    match = re.search(rb"<" + tag + rb" [^>]*" + attr + rb'="(-?\d+)"', xml)
    return int(match.group(1)) if match else None


def _recv(sock: _ReplaySocket, should_stop: Callable[[], bool]) -> bytes:
    """Read one chunk, retrying on timeout so the stop flag is honoured promptly."""
    while True:
        try:
            chunk = sock.recv(_RECV_SIZE)
        except TimeoutError:
            if should_stop():
                raise _Stopped from None
            continue
        if not chunk:
            raise _SocketClosed
        return chunk


def _read_message(
    sock: _ReplaySocket, buffer: bytes, should_stop: Callable[[], bool]
) -> tuple[_Message, bytes]:
    """
    Read one framed server message, returning it and any leftover buffer bytes.

    Server packets carry the same 32-byte frame prefix as client frames, followed
    by an XML header (whose ``<Length>`` gives the binary body size) and a trailing
    32-byte MD5 over the framed body.
    """
    while _XML_PREFIX not in buffer:
        buffer += _recv(sock, should_stop)
    prefix = buffer.index(_XML_PREFIX)
    if prefix:
        buffer = buffer[prefix:]  # drop the leading frame header

    while (match := _XML_END.search(buffer)) is None:
        buffer += _recv(sock, should_stop)
    xml_end = match.end()

    while len(buffer) < xml_end + 2:  # the CRLF after the closing tag
        buffer += _recv(sock, should_stop)
    body_end = xml_end + 2
    xml = buffer[:xml_end]

    length = _xml_int(xml, b"Length")
    if length is not None:
        while len(buffer) < body_end + length + _MD5_HEX_LEN:
            buffer += _recv(sock, should_stop)
        data = buffer[body_end : body_end + length]
        framed = buffer[: body_end + length]
        digest = buffer[body_end + length : body_end + length + _MD5_HEX_LEN]
        rest = buffer[body_end + length + _MD5_HEX_LEN :]
    else:
        while len(buffer) < body_end + _MD5_HEX_LEN:
            buffer += _recv(sock, should_stop)
        data = b""
        framed = buffer[:body_end]
        digest = buffer[body_end : body_end + _MD5_HEX_LEN]
        rest = buffer[body_end + _MD5_HEX_LEN :]

    message = _Message(
        data=data,
        md5_ok=_md5_hex(framed) == digest,
        result=_xml_int(xml, b"Result"),
        err_code=_xml_attr_int(xml, b"Type", b"ErrCode"),
        data_type=_xml_int(xml, b"Type"),
    )
    return message, rest


def _default_socket(host: str, port: int) -> _ReplaySocket:
    """Open a TLS 1.2+ connection to the replay server (production socket factory)."""
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    raw = socket.create_connection((host, port), timeout=_CONNECT_TIMEOUT)
    tls = context.wrap_socket(raw, server_hostname=host)
    tls.settimeout(_READ_TIMEOUT)
    return tls


def _run_cloud_replay(  # noqa: PLR0913 - the open request needs the full clip descriptor
    *,
    stream_url: str,
    ticket: str,
    serial: str,
    channel: int,
    seq_id: str | int,
    begin_cas: str,
    end_cas: str,
    storage_version: int,
    video_type: int,
    on_media: Callable[[bytes], None],
    should_stop: Callable[[], bool],
    file_size: int | None = None,
    socket_factory: Callable[[str, int], _ReplaySocket] | None = None,
) -> None:
    """
    Blocking: open the clip, call ``on_media`` for each media payload, return at end.

    Ends on the server's end-of-stream marker or, when ``file_size`` is known, once
    that many media bytes have arrived - the server may close the socket without a
    clean EOF frame, so the byte count is the reliable stop. Raises
    :class:`CloudReplayError` on a protocol/transport failure and :class:`_Stopped`
    if ``should_stop`` becomes true mid-read.
    """
    host, port = _parse_stream_url(stream_url)
    request = _build_open_xml(
        ticket=ticket,
        serial=serial,
        channel=channel,
        seq_id=seq_id,
        begin_cas=begin_cas,
        end_cas=end_cas,
        storage_version=storage_version,
        video_type=video_type,
    )
    sock = (socket_factory or _default_socket)(host, port)
    sequence = 1
    buffer = b""
    received = 0
    last_heartbeat = time.monotonic()
    try:
        sock.sendall(_frame(request, sequence=sequence, command=_OPEN_CMD))
        sequence += 1
        while not should_stop():
            try:
                message, buffer = _read_message(sock, buffer, should_stop)
            except _SocketClosed:
                return  # the server closes the socket to signal end-of-stream
            if not message.md5_ok:
                msg = "cloud-replay packet failed MD5 validation"
                raise CloudReplayError(msg)
            if message.result not in (None, 0):
                msg = f"cloud-replay returned error result {message.result}"
                raise CloudReplayError(msg)
            if message.err_code not in (None, 0):
                msg = f"cloud-replay returned packet error {message.err_code}"
                raise CloudReplayError(msg)
            if message.data_type in _DATA_TYPES_MEDIA and message.data:
                on_media(message.data)
                received += len(message.data)
                if file_size is not None and received >= file_size:
                    return
            elif message.data_type == _DATA_TYPE_EOF:
                return
            now = time.monotonic()
            if now - last_heartbeat >= _HEARTBEAT_INTERVAL:
                sock.sendall(
                    _frame(_heartbeat_xml(), sequence=sequence, command=_HEARTBEAT_CMD)
                )
                sequence += 1
                last_heartbeat = now
    finally:
        with contextlib.suppress(OSError):
            sock.close()


async def iter_cloud_replay_ps(  # noqa: PLR0913 - the open request needs the descriptor
    *,
    stream_url: str,
    ticket: str,
    serial: str,
    channel: int,
    seq_id: str | int,
    begin_cas: str,
    end_cas: str,
    storage_version: int = 2,
    video_type: int = 2,
    verification_code: str = "",
    file_size: int | None = None,
    socket_factory: Callable[[str, int], _ReplaySocket] | None = None,
) -> AsyncIterator[bytes]:
    """
    Yield decrypted MPEG-PS bytes for one cloud-stored clip, start to finish.

    Runs the blocking socket loop in a worker thread; media chunks are decrypted
    incrementally (when ``verification_code`` is given) and bridged to the event
    loop through a bounded queue. The generator ends when the server signals EOF;
    stopping iteration early tears the session down.
    """
    bridge: queue.Queue[bytes | object] = queue.Queue(maxsize=_QUEUE_MAX)
    stop = threading.Event()
    sentinel = object()

    def worker() -> None:
        decryptor = (
            StreamingPsDecryptor(verification_code, decrypt_audio=True)
            if verification_code
            else None
        )

        def on_media(chunk: bytes) -> None:
            out = decryptor.feed(chunk) if decryptor is not None else chunk
            if out:
                bridge.put(out)  # blocks when full -> backpressures the socket

        try:
            _run_cloud_replay(
                stream_url=stream_url,
                ticket=ticket,
                serial=serial,
                channel=channel,
                seq_id=seq_id,
                begin_cas=begin_cas,
                end_cas=end_cas,
                storage_version=storage_version,
                video_type=video_type,
                on_media=on_media,
                should_stop=stop.is_set,
                file_size=file_size,
                socket_factory=socket_factory,
            )
            if decryptor is not None:
                tail = decryptor.flush()
                if tail:
                    bridge.put(tail)
            bridge.put(sentinel)
        except _Stopped:
            bridge.put(sentinel)
        except Exception as err:  # noqa: BLE001 - deliver any failure to the consumer
            bridge.put(err)

    thread = threading.Thread(target=worker, name="ezviz-cloud-replay", daemon=True)
    thread.start()
    try:
        while True:
            item = await asyncio.to_thread(bridge.get)
            if item is sentinel:
                break
            if isinstance(item, Exception):
                raise item
            if isinstance(item, bytes):
                yield item
    finally:
        stop.set()
        # Free any slot the worker is blocked on so it can observe the stop flag.
        with contextlib.suppress(queue.Empty):
            while True:
                bridge.get_nowait()
        await asyncio.to_thread(thread.join, _JOIN_TIMEOUT)

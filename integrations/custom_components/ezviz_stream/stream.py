"""
Async VTM/VTDU streaming client: handshake, media loop, and frame grab.

Drives the ``ysproto`` handshake over asyncio sockets (non-blocking, so it runs in
HA's event loop), reads channel-0x01 media, de-packetises RTP→HEVC or decrypts
encrypted MPEG-PS, and can grab a single decoded JPEG across the ~27 s VTDU drop.
The proven logic is ported from ``scripts/ezviz_cloud.py`` /
``ezviz_stream_probe.py``; the pure protocol/codec bits live in :mod:`ysproto` and
:mod:`decrypt`.

Live verification: the socket path can't be unit-tested in CI (it needs the real
cloud), so it is exercised against a real account - as the diagnostic scripts were.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import TYPE_CHECKING, Any

from .decrypt_stream import StreamingPsDecryptor, decrypt_ps_video
from .ysproto import (
    CH_STREAM,
    MSG_STREAMINFO_RSP,
    HevcDepacketizer,
    build_keepalive,
    build_stream_url,
    build_streaminfo_request,
    decode_protobuf,
    detect_transport,
    field_str,
    read_frame,
    scan_ysproto,
    set_stream_param,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Awaitable, Callable
    from typing import IO

    from .api import EzvizCamera

_LOGGER = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 10
_HANDSHAKE_TIMEOUT = 10
_KEEPALIVE_INTERVAL = 10.0  # matches the official client (packet capture); it FINs
_READ_SLICE = 5.0
_RETRY_BACKOFF = 2.0  # brief pause between sessions (wakes a sleeping cam; eases CAS)
# Give up a live stream after this many consecutive attempts that yield no media - a
# handshake failure (e.g. 5404 device-offline) or a session that produced nothing.
# Prevents an unbounded reconnect loop hammering an offline/asleep camera forever (a
# productive session resets the count, so the normal ~27 s VTDU drop never trips it).
# ~10 attempts x ~3 s ≈ 30 s: long enough to let a sleeping battery cam wake (which
# can report 5404 while waking), short enough not to spin for minutes when truly gone.
_MAX_STREAM_FAILURES = 10
_RECV = 65536
_FFMPEG_FMT = {"rtp": "hevc", "mpeg-ps": "mpeg", "mpeg-ts": "mpegts"}
_MIN_JPEG_BYTES = 5000  # smaller than a real frame => a decode artifact
# StreamInfoRsp results that mean "too many streams / out of capacity" (reference
# B.12) - distinct from the churn timeout 5405. Surfaced so a tuned concurrency cap
# can be judged empirically (hit the wall vs. just churn).
_CONCURRENCY_LIMIT_CODES = frozenset({5416, 5503, 5504, 5546})


class StreamError(Exception):
    """A streaming handshake or media error."""


class _FrameReader:
    """Read ysproto frames from an asyncio stream, buffering across reads."""

    def __init__(self, reader: asyncio.StreamReader) -> None:
        self._reader = reader
        self._buf = bytearray()
        self.closed = False

    async def next_frame(self, deadline: float) -> tuple[int, int, bytes] | None:
        """Return the next (channel, msgcode, body) or None on timeout/close."""
        loop = asyncio.get_running_loop()
        while True:
            frame, consumed = read_frame(bytes(self._buf))
            if consumed:
                del self._buf[:consumed]
            if frame is not None:
                return frame
            timeout = deadline - loop.time()
            if timeout <= 0:
                return None
            try:
                chunk = await asyncio.wait_for(self._reader.read(_RECV), timeout)
            except TimeoutError:
                return None
            if not chunk:
                self.closed = True
                return None
            self._buf += chunk


async def _streaminfo_exchange(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    stream_url: str,
    vtm_stream_key: str | None,
) -> dict[int, list[Any]]:
    """Send a StreamInfoReq and return the decoded StreamInfoRsp fields."""
    writer.write(build_streaminfo_request(stream_url, vtm_stream_key))
    await writer.drain()
    frames = _FrameReader(reader)
    deadline = asyncio.get_running_loop().time() + _HANDSHAKE_TIMEOUT
    while True:
        frame = await frames.next_frame(deadline)
        if frame is None:
            msg = "no StreamInfoRsp before timeout"
            raise StreamError(msg)
        _ch, msgcode, body = frame
        if msgcode == MSG_STREAMINFO_RSP:
            return decode_protobuf(body)


async def _open_connection(
    host: str, port: int
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    try:
        return await asyncio.wait_for(
            asyncio.open_connection(host, port), _CONNECT_TIMEOUT
        )
    except OSError as err:  # TimeoutError is a subclass of OSError
        msg = f"cannot connect to {host}:{port}: {err}"
        raise StreamError(msg) from err


async def open_stream(
    camera: EzvizCamera,
    token: str,
    *,
    stream: int,
    time_range: tuple[str, str] | None = None,
) -> tuple[asyncio.StreamReader, asyncio.StreamWriter, str | None]:
    """
    Do the VTM/VTDU handshake; return the VTDU (reader, writer, streamssn).

    With ``time_range`` (``(begin, end)`` CAS timestamps) this requests SD-card
    playback (``/playback``) instead of the live stream; the handshake is otherwise
    identical (reference: scripts/in/EzViz_Capture_Replay_SD.pcapng).
    """
    if not camera.vtm_ip or not camera.vtm_port:
        msg = f"camera {camera.serial} has no VTM routing"
        raise StreamError(msg)

    # 1) VTM: ask where to stream.
    vtm_reader, vtm_writer = await _open_connection(camera.vtm_ip, camera.vtm_port)
    vtm_url = build_stream_url(
        camera.vtm_ip,
        camera.vtm_port,
        camera.serial,
        camera.channel,
        token,
        stream=stream,
        biz=camera.biz,
        timestamp_ms=int(time.time() * 1000),
        time_range=time_range,
    )
    try:
        fields = await _streaminfo_exchange(vtm_reader, vtm_writer, vtm_url, None)
    finally:
        vtm_writer.close()

    redirect = field_str(fields, 7)
    if not redirect:
        raw = b"".join(
            v for vals in fields.values() for v in vals if isinstance(v, bytes)
        )
        redirect = scan_ysproto(raw)
    if not redirect:
        msg = "VTM gave no VTDU redirect"
        raise StreamError(msg)
    vtm_key = field_str(fields, 5)
    host_part = redirect.split("//", 1)[1].split("/", 1)[0]
    vtdu_ip, _, vtdu_port = host_part.partition(":")
    redirect = set_stream_param(redirect, stream)  # keep the requested track

    # 2) VTDU: reuse the redirect URL, now carrying the vtmstreamkey.
    vtdu_reader, vtdu_writer = await _open_connection(vtdu_ip, int(vtdu_port))
    rsp = await _streaminfo_exchange(vtdu_reader, vtdu_writer, redirect, vtm_key)
    result = (rsp.get(1) or [0])[0]
    if result not in (0, None):
        vtdu_writer.close()
        if result in _CONCURRENCY_LIMIT_CODES:
            _LOGGER.warning(
                "EZVIZ concurrency/resource limit hit (result=%s): too many "
                "simultaneous cloud streams - reduce concurrent viewers/snapshots",
                result,
            )
        msg = f"VTDU StreamInfoRsp result={result}"
        raise StreamError(msg)
    stream_ssn = field_str(rsp, 4)
    # VTDU endpoint for this session: filter a packet capture on this ip:port to
    # isolate the media flow and inspect the ~27 s drop / keepalive handling.
    _LOGGER.debug(
        "%s: VTDU %s:%s stream=%s keepalive=%s",
        camera.serial,
        vtdu_ip,
        vtdu_port,
        stream,
        "on" if stream_ssn else "off",
    )
    return vtdu_reader, vtdu_writer, stream_ssn


async def _capture_session(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    stream_ssn: str | None,
    *,
    verification_code: str,
    deadline: float,
) -> tuple[str | None, bytes]:
    """Read one VTDU session's media, returning (transport, decodable bytes)."""
    loop = asyncio.get_running_loop()
    frames = _FrameReader(reader)
    depacketizer = HevcDepacketizer()
    last_ka = loop.time()
    ka_seq = 1
    transport: str | None = None
    out = bytearray()

    while loop.time() < deadline:
        if stream_ssn and loop.time() - last_ka >= _KEEPALIVE_INTERVAL:
            writer.write(build_keepalive(stream_ssn, seq=ka_seq))
            await writer.drain()
            ka_seq += 1
            last_ka = loop.time()
        frame = await frames.next_frame(min(deadline, loop.time() + _READ_SLICE))
        if frame is None:
            if frames.closed:
                break
            continue
        channel, _msg, body = frame
        if channel != CH_STREAM or not body:
            continue
        if transport is None:
            transport = detect_transport(body)
        if transport == "rtp":
            out += depacketizer.push(body)
        else:
            out += body

    if transport in ("mpeg-ps", "mpeg-ts") and verification_code:
        # AES over the whole captured buffer is CPU-heavy; run it off the event loop
        # so it does not stall Home Assistant (asyncio logs slow on-loop steps).
        decrypted = await asyncio.to_thread(
            decrypt_ps_video, bytes(out), verification_code
        )
        out = bytearray(decrypted)
    return transport, bytes(out)


async def _decode_jpeg(
    ffmpeg_bin: str, transport: str | None, media: bytes
) -> bytes | None:
    """Decode a single JPEG from captured media via FFmpeg (stdin to stdout)."""
    fmt = _FFMPEG_FMT.get(transport or "")
    args = [ffmpeg_bin, "-hide_banner", "-v", "error", "-y"]
    if fmt:
        args += ["-f", fmt]
    # Decode keyframes only: a mid-GOP window would otherwise yield a P-frame decoded
    # without its reference, or a half-decoded frame from an incomplete keyframe -
    # either way a corrupt/partial image. -frames:v 1 then emits the first complete
    # keyframe, or nothing (better than a half image).
    args += ["-skip_frame", "nokey", "-i", "pipe:0", "-frames:v", "1"]
    args += ["-f", "image2", "pipe:1"]
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    jpeg, _ = await proc.communicate(media)
    return jpeg if len(jpeg) >= _MIN_JPEG_BYTES else None


async def capture_jpeg_from_ts(
    ffmpeg_bin: str,
    source: AsyncIterator[bytes],
    *,
    timeout: float,  # noqa: ASYNC109 - a caller-supplied capture budget, used via wait_for
) -> bytes | None:
    """
    Decode one complete keyframe JPEG from a *live* MPEG-TS stream.

    Unlike :func:`_decode_jpeg` (which decodes a fixed buffer and can emit a partial
    frame if the buffer was cut mid-keyframe), this pipes ``source`` into FFmpeg and
    reads the single frame it emits only once it has fully decoded a keyframe
    (``-skip_frame nokey -frames:v 1``). FFmpeg controls completeness, so a mid-GOP tap
    can never yield a half image; it returns None if no keyframe arrives within
    ``timeout`` or the source is empty (nothing was streaming).
    """
    proc = await asyncio.create_subprocess_exec(
        ffmpeg_bin,
        "-hide_banner",
        "-v",
        "error",
        "-skip_frame",
        "nokey",
        "-f",
        "mpegts",
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-f",
        "image2",
        "pipe:1",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    assert proc.stdin is not None  # noqa: S101 - PIPE guarantees a writer
    assert proc.stdout is not None  # noqa: S101 - PIPE guarantees a reader
    stdin = proc.stdin  # bound local so the None-narrowing holds inside _feed

    async def _feed() -> None:
        try:
            async for chunk in source:
                stdin.write(chunk)
                await stdin.drain()
        except OSError:
            # BrokenPipeError/ConnectionResetError both derive from OSError:
            # FFmpeg emitted its frame and exited, so stop feeding.
            pass
        finally:
            with contextlib.suppress(OSError):
                stdin.close()

    feeder = asyncio.create_task(_feed())
    try:
        jpeg = await asyncio.wait_for(proc.stdout.read(), timeout)
    except TimeoutError:
        jpeg = b""
    finally:
        feeder.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await feeder
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
        with contextlib.suppress(Exception):
            await proc.wait()
    return jpeg if len(jpeg) >= _MIN_JPEG_BYTES else None


async def grab_jpeg(  # noqa: PLR0913 - a session needs camera, token, ffmpeg + tuning
    camera: EzvizCamera,
    token_factory: Callable[[], Awaitable[str]],
    ffmpeg_bin: str,
    *,
    stream: int,
    verification_code: str,
    duration: float = 60.0,
    max_sessions: int = 6,
) -> bytes | None:
    """
    Grab a single decoded JPEG, reconnecting across the ~27 s VTDU drop.

    ``token_factory`` returns a fresh VTDU token per session (each reconnect needs a
    new one). Returns the JPEG bytes, or None if none decoded within the budget.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + duration
    session = 0
    while loop.time() < deadline and session < max_sessions:
        if session:  # brief backoff before a retry (a battery cam may still be waking)
            await asyncio.sleep(min(_RETRY_BACKOFF, max(0.0, deadline - loop.time())))
        session += 1
        try:
            token = await token_factory()
            reader, writer, stream_ssn = await open_stream(camera, token, stream=stream)
        except StreamError as err:
            _LOGGER.debug("session %s handshake failed: %s", session, err)
            continue
        try:
            transport, media = await _capture_session(
                reader,
                writer,
                stream_ssn,
                verification_code=verification_code,
                deadline=deadline,
            )
        finally:
            writer.close()
        if not media:
            continue
        jpeg = await _decode_jpeg(ffmpeg_bin, transport, media)
        if jpeg:
            _LOGGER.debug("decoded a frame after %s session(s)", session)
            return jpeg
    return None


class _SessionTrace:
    """
    Per-session diagnostics for the reconnect loops (one DEBUG line per session).

    Temporary instrumentation to explain live-view buffering and correlate with a
    packet capture: it records the idle ``gap`` before the session, the handshake
    latency, time-to-first-frame, how long media flowed, frame/byte counts,
    keepalives sent, and any control-channel frames the server sent back (which would
    include a keepalive acknowledgement). ``clock`` returns monotonic seconds and is
    injected for testing.
    """

    def __init__(
        self,
        label: str,
        serial: str,
        session: int,
        *,
        clock: Callable[[], float],
        gap: float | None,
    ) -> None:
        """Start a trace for a session (``gap`` = idle seconds since the last)."""
        self._label = label
        self._serial = serial
        self._session = session
        self._clock = clock
        self._gap = gap
        self._opened = clock()
        self._ready: float | None = None
        self._first: float | None = None
        self._frames = 0
        self._bytes = 0
        self._keepalives = 0
        self._control: dict[int, int] = {}

    def ready(self) -> None:
        """Mark the handshake complete (media can now flow)."""
        self._ready = self._clock()

    def media(self, nbytes: int) -> None:
        """Record one media chunk of ``nbytes`` handed to the consumer."""
        if self._first is None:
            self._first = self._clock()
        self._frames += 1
        self._bytes += nbytes

    def keepalive(self) -> None:
        """Record a keepalive frame sent to the VTDU."""
        self._keepalives += 1

    def control(self, msgcode: int) -> None:
        """Record a control-channel frame received (e.g. a keepalive response)."""
        self._control[msgcode] = self._control.get(msgcode, 0) + 1

    @staticmethod
    def _span(start: float | None, end: float | None) -> str:
        if start is None or end is None:
            return "-"
        return f"{(end - start) * 1000:.0f}ms"

    def log(self, reason: str) -> None:
        """Emit the one-line session summary at DEBUG."""
        now = self._clock()
        _LOGGER.debug(
            "%s session #%s [%s]: gap=%s handshake=%s ttff=%s live=%.1fs frames=%s "
            "bytes=%s keepalive=%s control=%s drop=%s",
            self._serial,
            self._session,
            self._label,
            "-" if self._gap is None else f"{self._gap:.1f}s",
            self._span(self._opened, self._ready),
            self._span(self._ready, self._first),
            0.0 if self._ready is None else now - self._ready,
            self._frames,
            self._bytes,
            self._keepalives,
            self._control or "{}",
            reason,
        )


async def iter_annexb(  # noqa: PLR0915 - reconnect loop + tracing
    camera: EzvizCamera,
    token_factory: Callable[[], Awaitable[str]],
    *,
    stream: int,
) -> AsyncIterator[tuple[int, bytes]]:
    """
    Yield ``(rtp_timestamp, annexb_chunk)`` continuously, reconnecting across the drop.

    The RTP 90 kHz timestamp is the camera's own presentation clock for that access
    unit; the broadcaster paces playback to it so the VTDU's bursty delivery stays
    smooth. For RTP/HEVC cameras (battery cams) only. Runs until the consumer stops
    iterating (the driving task is cancelled when no client is watching -
    battery-friendly). MPEG-PS (encrypted IPC) needs continuous decryption + a remux
    and is handled separately (C.2b). ``token_factory`` yields a fresh VTDU token per
    reconnect.
    """
    loop = asyncio.get_running_loop()
    failures = 0
    session_no = 0
    last_end: float | None = None
    while True:
        if failures >= _MAX_STREAM_FAILURES:
            _LOGGER.warning(
                "camera %s: giving up the stream after %s attempts with no media "
                "(device offline/unreachable)",
                camera.serial,
                failures,
            )
            return
        session_no += 1
        gap = None if last_end is None else loop.time() - last_end
        trace = _SessionTrace(
            "rtp", camera.serial, session_no, clock=loop.time, gap=gap
        )
        try:
            token = await token_factory()
            reader, writer, stream_ssn = await open_stream(camera, token, stream=stream)
        except StreamError as err:
            failures += 1
            _LOGGER.debug(
                "stream handshake failed (%s/%s): %s",
                failures,
                _MAX_STREAM_FAILURES,
                err,
            )
            last_end = loop.time()
            await asyncio.sleep(_RETRY_BACKOFF)
            continue
        trace.ready()

        frames = _FrameReader(reader)
        depacketizer = HevcDepacketizer()
        last_ka = loop.time()
        ka_seq = 1
        produced = False
        try:
            while True:
                if stream_ssn and loop.time() - last_ka >= _KEEPALIVE_INTERVAL:
                    writer.write(build_keepalive(stream_ssn, seq=ka_seq))
                    await writer.drain()
                    trace.keepalive()
                    ka_seq += 1
                    last_ka = loop.time()
                frame = await frames.next_frame(loop.time() + _READ_SLICE)
                if frame is None:
                    if frames.closed:
                        break  # the VTDU drop; reconnect below
                    continue
                channel, msgcode, body = frame
                if channel != CH_STREAM:
                    trace.control(msgcode)  # e.g. a keepalive response
                    continue
                if not body:
                    continue
                if detect_transport(body) == "rtp":
                    chunk = depacketizer.push(body)
                    if chunk:
                        produced = True
                        trace.media(len(chunk))
                        # RTP 90 kHz timestamp of the packet completing this access
                        # unit (bytes 4-8 of the RTP header).
                        yield int.from_bytes(body[4:8], "big"), chunk
        finally:
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()
        trace.log("peer-closed")
        failures = 0 if produced else failures + 1  # a productive session resets it
        last_end = loop.time()
        await asyncio.sleep(_RETRY_BACKOFF)


async def iter_ps_decrypted(  # noqa: PLR0912, PLR0915 - reconnect loop + tracing
    camera: EzvizCamera,
    token_factory: Callable[[], Awaitable[str]],
    *,
    stream: int,
    verification_code: str,
) -> AsyncIterator[bytes]:
    """
    Yield MPEG-PS bytes for an IPC camera, decrypting Image-Encryption on the fly.

    Reconnects across the ~27 s drop like :func:`iter_annexb`. With a
    ``verification_code`` a :class:`~.decrypt.StreamingPsDecryptor` decrypts complete
    video-PES runs incrementally (a fresh one per session, so the incomplete run left
    by a dropped session is simply discarded); otherwise the PS passes through. The PS
    container carries its own PTS, so the consumer feeds ffmpeg ``-f mpeg`` with no
    pacing needed.
    """
    loop = asyncio.get_running_loop()
    failures = 0
    session_no = 0
    last_end: float | None = None
    while True:
        if failures >= _MAX_STREAM_FAILURES:
            _LOGGER.warning(
                "camera %s: giving up the stream after %s attempts with no media "
                "(device offline/unreachable)",
                camera.serial,
                failures,
            )
            return
        session_no += 1
        gap = None if last_end is None else loop.time() - last_end
        trace = _SessionTrace("ps", camera.serial, session_no, clock=loop.time, gap=gap)
        try:
            token = await token_factory()
            reader, writer, stream_ssn = await open_stream(camera, token, stream=stream)
        except StreamError as err:
            failures += 1
            _LOGGER.debug(
                "PS stream handshake failed (%s/%s): %s",
                failures,
                _MAX_STREAM_FAILURES,
                err,
            )
            last_end = loop.time()
            await asyncio.sleep(_RETRY_BACKOFF)
            continue
        trace.ready()

        frames = _FrameReader(reader)
        last_ka = loop.time()
        ka_seq = 1
        produced = False
        decryptor = (
            StreamingPsDecryptor(verification_code) if verification_code else None
        )
        transport = None
        try:
            while True:
                if stream_ssn and loop.time() - last_ka >= _KEEPALIVE_INTERVAL:
                    writer.write(build_keepalive(stream_ssn, seq=ka_seq))
                    await writer.drain()
                    trace.keepalive()
                    ka_seq += 1
                    last_ka = loop.time()
                frame = await frames.next_frame(loop.time() + _READ_SLICE)
                if frame is None:
                    if frames.closed:
                        break  # the VTDU drop; reconnect below
                    continue
                channel, msgcode, body = frame
                if channel != CH_STREAM:
                    trace.control(msgcode)  # e.g. a keepalive response
                    continue
                if not body:
                    continue
                # 每个会话只用首包识别格式，后续包可能从任意位置截断。
                if transport is None:
                    transport = detect_transport(body)
                # RTP 内容不属于 PS 加密格式，保留原包供媒体层识别和解包。
                if decryptor is not None and transport != "rtp":
                    # Decrypt off the event loop - continuous AES during live view
                    # would otherwise keep the loop busy for the whole stream.
                    chunk = await asyncio.to_thread(decryptor.feed, body)
                else:
                    chunk = body
                if chunk:
                    produced = True
                    trace.media(len(chunk))
                    yield chunk
        finally:
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()
        trace.log("peer-closed")
        failures = 0 if produced else failures + 1  # a productive session resets it
        last_end = loop.time()
        await asyncio.sleep(_RETRY_BACKOFF)


async def iter_playback_ps(  # noqa: PLR0913 - camera, token, tuning + the time range
    camera: EzvizCamera,
    token_factory: Callable[[], Awaitable[str]],
    *,
    stream: int,
    verification_code: str,
    begin_cas: str,
    end_cas: str,
) -> AsyncIterator[bytes]:
    """
    Yield decrypted MPEG-PS for one SD-card recording segment ``[begin, end]``.

    A single **finite** ysproto ``/playback`` session (reference:
    scripts/in/EzViz_Capture_Replay_SD.pcapng): opens once, streams until the segment
    ends (the VTDU closes the session) and decrypts on the fly like
    :func:`iter_ps_decrypted`. Unlike live it does NOT reconnect - a closed session
    means the clip finished, so the generator ends.
    """
    loop = asyncio.get_running_loop()
    token = await token_factory()
    try:
        reader, writer, stream_ssn = await open_stream(
            camera, token, stream=stream, time_range=(begin_cas, end_cas)
        )
    except StreamError as err:
        _LOGGER.debug("SD playback handshake failed for %s: %s", camera.serial, err)
        return

    frames = _FrameReader(reader)
    last_ka = loop.time()
    ka_seq = 1
    decryptor = (
        StreamingPsDecryptor(verification_code, decrypt_audio=True)
        if verification_code
        else None
    )
    try:
        while True:
            if stream_ssn and loop.time() - last_ka >= _KEEPALIVE_INTERVAL:
                writer.write(build_keepalive(stream_ssn, seq=ka_seq))
                await writer.drain()
                ka_seq += 1
                last_ka = loop.time()
            frame = await frames.next_frame(loop.time() + _READ_SLICE)
            if frame is None:
                if frames.closed:
                    break  # segment finished; the VTDU closed the session
                continue
            channel, _msgcode, body = frame
            if channel != CH_STREAM or not body:
                continue
            if decryptor is not None:
                chunk = await asyncio.to_thread(decryptor.feed, body)
            else:
                chunk = body
            if chunk:
                yield chunk
        if decryptor is not None:
            tail = await asyncio.to_thread(decryptor.flush)
            if tail:
                yield tail
    finally:
        writer.close()
        with contextlib.suppress(OSError):
            await writer.wait_closed()


async def stream_annexb(
    camera: EzvizCamera,
    token_factory: Callable[[], Awaitable[str]],
    out: IO[bytes],
    *,
    stream: int,
) -> None:
    """
    Write the continuous Annex-B HEVC stream to ``out`` (blocking file-like).

    Thin wrapper over :func:`iter_annexb` for the standalone CLI producer
    (``scripts/ezviz_producer.py``); the integration itself consumes ``iter_annexb``
    in-process via :mod:`broadcast`. Runs until cancelled. The RTP timestamp is unused
    here (the CLI just dumps the bitstream).
    """
    async for _rtp_ts, chunk in iter_annexb(camera, token_factory, stream=stream):
        out.write(chunk)
        out.flush()

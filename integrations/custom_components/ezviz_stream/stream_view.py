"""
HTTP view serving a camera's live MPEG-TS stream to go2rtc and the stream component.

go2rtc refuses ``exec:`` sources via its API (only ``rtsp``/``http``-style sources
are accepted), and HA's ``stream`` component can only ffmpeg-open a URL - so
``stream_source()`` points here. This view runs the camera's on-demand
:class:`~.broadcast.CameraBroadcast` and streams MPEG-TS to whoever connects
(go2rtc, the stream component, or ffmpeg for a snapshot); the broadcaster ensures
they all share one cloud session.

The endpoint carries a per-camera random token in the query (checked in constant
time) rather than HA auth, so a local, credential-less consumer like go2rtc can read
it; account credentials never touch this path.
"""

from __future__ import annotations

import hmac
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

from aiohttp import web
from homeassistant.components.ffmpeg import get_ffmpeg_manager

# Import from the defining module: homeassistant.components.http re-exports this
# without an explicit __all__ entry, which mypy's no_implicit_reexport rejects.
from homeassistant.helpers.http import HomeAssistantView

from .api import EzvizStreamApiError, SdRecording
from .broadcast import replay_mp4_source
from .cloud_replay import iter_cloud_replay_ps
from .const import DOMAIN, SUB_STREAM
from .stream import iter_playback_ps

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from homeassistant.core import HomeAssistant

    from .api import EzvizCamera, EzvizCloudApi
    from .broadcast import CameraBroadcast

_LOGGER = logging.getLogger(__name__)

DATA_STREAMS = "media_streams"  # hass.data[DOMAIN][DATA_STREAMS]: serial -> _Stream


@dataclass
class _Stream:
    """
    A registered camera stream: token, live broadcaster, and replay inputs.

    ``api`` and ``verification_code`` let the replay view fetch a clip descriptor +
    playback ticket and decrypt the cloud-stored recording on demand.
    """

    token: str
    broadcast: CameraBroadcast
    api: EzvizCloudApi
    verification_code: str


def _registry(hass: HomeAssistant) -> dict[str, _Stream]:
    """Return (creating if needed) the serial -> stream registry."""
    return cast(
        "dict[str, _Stream]",
        hass.data.setdefault(DOMAIN, {}).setdefault(DATA_STREAMS, {}),
    )


def register_stream(  # noqa: PLR0913 - live + replay both keyed off the same camera
    hass: HomeAssistant,
    serial: str,
    token: str,
    broadcast: CameraBroadcast,
    api: EzvizCloudApi,
    verification_code: str,
) -> None:
    """Register a camera's broadcaster + replay inputs so the views can serve it."""
    _registry(hass)[serial] = _Stream(token, broadcast, api, verification_code)


def unregister_stream(hass: HomeAssistant, serial: str) -> None:
    """Remove a camera's broadcaster (on entity removal)."""
    _registry(hass).pop(serial, None)


def replay_token(hass: HomeAssistant, serial: str) -> str | None:
    """Return a registered camera's access token (for building a replay URL)."""
    entry = _registry(hass).get(serial)
    return entry.token if entry else None


class EzvizStreamMediaView(HomeAssistantView):
    """Serve on-demand MPEG-TS for a camera, guarded by a per-camera token."""

    url = "/api/ezviz_stream/{serial}"
    name = "api:ezviz_stream"
    requires_auth = False  # a per-camera token in the query guards it instead

    def __init__(self, hass: HomeAssistant) -> None:
        """Store the hass reference used to look up registered streams."""
        self.hass = hass

    async def get(self, request: web.Request, serial: str) -> web.StreamResponse:
        """Stream MPEG-TS for ``serial`` while the client stays connected."""
        entry = _registry(self.hass).get(serial)
        token = request.query.get("token", "")
        # One response for both failure modes so a caller can't probe valid serials.
        if entry is None or not hmac.compare_digest(token, entry.token):
            raise web.HTTPNotFound

        response = web.StreamResponse()
        response.content_type = "video/mp2t"
        await response.prepare(request)
        try:
            async for chunk in entry.broadcast.subscribe():
                await response.write(chunk)
        except ConnectionError:  # covers ConnectionResetError
            pass  # client (go2rtc/ffmpeg) disconnected; unsubscribe happens in finally
        return response


class EzvizReplayView(HomeAssistantView):
    """
    Serve a cloud-stored recording as fragmented H.264 MP4 (token-guarded).

    Resolved from the media_source platform. On GET it fetches the clip descriptor
    and a fresh playback ticket, streams the encrypted cloud-replay clip through the
    decryptor, and transcodes it to a browser-playable fragmented MP4.
    """

    url = "/api/ezviz_stream/{serial}/replay/{kind}/{ident}"
    name = "api:ezviz_stream:replay"
    requires_auth = False  # the per-camera token in the query guards it instead

    def __init__(self, hass: HomeAssistant) -> None:
        """Store the hass reference used to look up registered streams."""
        self.hass = hass

    async def get(
        self, request: web.Request, serial: str, kind: str, ident: str
    ) -> web.StreamResponse:
        """Stream a cloud (``kind=cloud``) or SD (``kind=sd``) clip as fMP4."""
        entry = _registry(self.hass).get(serial)
        token = request.query.get("token", "")
        # One response for every failure mode so a caller can't probe valid ids.
        if entry is None or not hmac.compare_digest(token, entry.token):
            raise web.HTTPNotFound

        try:
            camera = await self._camera(entry, serial)
            if camera is None:
                raise web.HTTPNotFound
            if kind == "cloud":
                source = await self._cloud_source(entry, camera, ident)
            elif kind == "sd":
                source = self._sd_source(entry, camera, ident)
            else:
                raise web.HTTPNotFound
        except EzvizStreamApiError as err:
            _LOGGER.debug("replay %s/%s/%s setup failed: %s", serial, kind, ident, err)
            raise web.HTTPNotFound from err
        if source is None:
            raise web.HTTPNotFound

        response = web.StreamResponse()
        response.content_type = "video/mp4"
        await response.prepare(request)
        try:
            async for chunk in source:
                await response.write(chunk)
        except ConnectionError:  # client closed the tab / seeked away
            pass
        return response

    async def _camera(self, entry: _Stream, serial: str) -> EzvizCamera | None:
        """Resolve the live camera descriptor for ``serial`` (VTM routing + channel)."""
        cameras = await entry.api.async_get_cameras()
        return next((c for c in cameras if c.serial == serial), None)

    async def _cloud_source(
        self, entry: _Stream, camera: EzvizCamera, seq_id: str
    ) -> AsyncIterator[bytes] | None:
        """Transcoded MP4 for a cloud recording via the cloud-replay socket."""
        videos = await entry.api.async_get_cloud_videos(camera.serial, camera.channel)
        rec = next(
            (
                v
                for v in videos
                if str(v.seq_id) == seq_id
                and v.stream_url
                and v.begin_cas
                and v.end_cas
            ),
            None,
        )
        if rec is None or rec.stream_url is None or rec.begin_cas is None:
            return None
        if rec.end_cas is None:
            return None
        ticket = await entry.api.async_get_camera_ticket(camera.serial, camera.channel)
        raw = iter_cloud_replay_ps(
            stream_url=rec.stream_url,
            ticket=ticket,
            serial=camera.serial,
            channel=camera.channel,
            seq_id=rec.seq_id,
            begin_cas=rec.begin_cas,
            end_cas=rec.end_cas,
            storage_version=rec.storage_version,
            verification_code="",
            file_size=rec.file_size,
        )
        # Per-clip decrypt (encryption can be toggled / the code rotated over a
        # camera's life) and per-clip audio decision (drop undecodable audio).
        ffmpeg = get_ffmpeg_manager(self.hass).binary
        return replay_mp4_source(ffmpeg, raw, entry.verification_code)

    def _sd_source(
        self, entry: _Stream, camera: EzvizCamera, ident: str
    ) -> AsyncIterator[bytes] | None:
        """Transcoded MP4 for an SD segment (``ident`` = ``begin_ms-end_ms``)."""
        begin_ms, _, end_ms = ident.partition("-")
        if not begin_ms.isdigit() or not end_ms.isdigit():
            return None
        segment = SdRecording(int(begin_ms), int(end_ms), None)
        raw = iter_playback_ps(
            camera,
            entry.api.async_get_vtdu_token,
            stream=SUB_STREAM,
            verification_code="",
            begin_cas=segment.begin_cas,
            end_cas=segment.end_cas,
        )
        # Per-clip decrypt (encryption can be toggled / the code rotated over a
        # camera's life) and per-clip audio decision (drop undecodable audio).
        ffmpeg = get_ffmpeg_manager(self.hass).binary
        return replay_mp4_source(ffmpeg, raw, entry.verification_code)

"""Camera platform for EZVIZ Stream: one entity per camera subentry."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import secrets
import time
from pathlib import Path
from typing import TYPE_CHECKING

from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.components.ffmpeg import get_ffmpeg_manager
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceInfo

from .broadcast import CameraBroadcast, mpegts_source
from .const import (
    CAMERA_SUBENTRY_TYPE,
    CONF_FORCE_H264,
    CONF_IS_BATTERY,
    CONF_MOTION_THUMBNAIL,
    CONF_SERIAL,
    CONF_SLOW_THUMBNAILS,
    CONF_SNAPSHOT_INTERVAL,
    CONF_STATIC_ANCHOR,
    CONF_STREAM,
    CONF_THUMBNAIL_MODE,
    CONF_VERIFICATION_CODE,
    DEFAULT_FORCE_H264,
    DEFAULT_SNAPSHOT_INTERVAL,
    DEFAULT_SNAPSHOT_INTERVAL_BATTERY,
    DEFAULT_STREAM,
    MANUFACTURER,
    OFFICIAL_EZVIZ_DOMAIN,
    THUMBNAIL_INTERVAL,
    THUMBNAIL_MOTION,
    THUMBNAIL_STATIC,
    THUMBNAIL_STATIC_MOTION,
)
from .stream import capture_jpeg_from_ts, grab_jpeg
from .stream_view import register_stream, unregister_stream

_LOGGER = logging.getLogger(__name__)

# A single-frame grab drives a brief live session; keep it short so HA's image
# fetch does not hang. Efficient live view arrives with go2rtc (Milestone C).
_SNAPSHOT_TIMEOUT = 30.0
_SNAPSHOT_MAX_SESSIONS = 3  # limit reconnect churn per image request
# On a cold cache, wait at most this long for the first grab - kept under HA's
# CAMERA_IMAGE_TIMEOUT (10 s) so the request returns before HA cancels it, while the
# grab keeps running in the background to populate the cache for the next request.
_COLD_GRAB_WAIT = 9.0
# "Static image (refreshed when viewed)" thumbnail: after a live view opens we tap the
# already-running broadcast (no extra cloud session) and let FFmpeg pull one complete
# keyframe from it. _DELAY lets the viewer's session come up first; _KEYFRAME_TIMEOUT
# bounds how long we wait for a keyframe (one GOP, generously).
_STREAM_CAPTURE_DELAY = 2.0
_STREAM_CAPTURE_KEYFRAME_TIMEOUT = 8.0
# The last good frame is persisted here so a cold start (the in-memory cache is empty
# after a restart) falls back to it instead of a blank tile until a fresh grab
# succeeds. It is camera imagery at rest: kept in the HA config dir, owner-only
# (0600), one small JPEG per camera; removed when the camera is removed.
_SNAPSHOT_DIR = "ezviz_stream"
_SNAPSHOT_FILE_MODE = 0o600

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping

    from homeassistant.config_entries import ConfigSubentry
    from homeassistant.core import HomeAssistant
    from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

    from . import EzvizStreamConfigEntry
    from .api import EzvizCamera, MotionImage


def _resolve_interval(data: Mapping[str, object]) -> float:
    """Resolve a camera's snapshot cache TTL from its subentry data (seconds)."""
    if CONF_SNAPSHOT_INTERVAL in data:
        return float(data[CONF_SNAPSHOT_INTERVAL])  # type: ignore[arg-type]
    # Legacy subentries predate the explicit interval: map the old boolean flag.
    if data.get(CONF_SLOW_THUMBNAILS):
        return float(DEFAULT_SNAPSHOT_INTERVAL_BATTERY)
    return float(DEFAULT_SNAPSHOT_INTERVAL)


def _resolve_thumbnail_mode(data: Mapping[str, object]) -> str:
    """Resolve the thumbnail source, mapping the legacy boolean when needed."""
    if mode := data.get(CONF_THUMBNAIL_MODE):
        return str(mode)
    # Legacy subentries predate the mode select: map the old boolean flag.
    return THUMBNAIL_MOTION if data.get(CONF_MOTION_THUMBNAIL) else THUMBNAIL_INTERVAL


def _write_snapshot(path: Path, data: bytes) -> None:
    """Persist the latest frame atomically, owner-only (executor job)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, _SNAPSHOT_FILE_MODE)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
    tmp.replace(path)  # atomic rename - a reader never sees a half-written file


def _read_snapshot(path: Path) -> bytes | None:
    """Return the persisted frame, or None if there is none (executor job)."""
    try:
        return path.read_bytes()
    except OSError:
        return None


def _remove_snapshot(path: Path) -> None:
    """Delete the persisted frame if present (executor job)."""
    path.unlink(missing_ok=True)


def _snapshot_path_for(hass: HomeAssistant, serial: str) -> Path:
    """Path to a camera's persisted last-good frame."""
    return Path(hass.config.path(_SNAPSHOT_DIR)) / f"{serial}.jpg"


def remove_snapshot_file(hass: HomeAssistant, serial: str) -> None:
    """
    Delete a camera's persisted snapshot on real removal (executor job).

    Deliberately not called on unload/reload: the frame is a restart fallback, so it
    must survive a restart and is removed only when the camera itself is deleted
    (see ``async_remove_*`` in :mod:`__init__`).
    """
    _remove_snapshot(_snapshot_path_for(hass, serial))


def persist_snapshot(hass: HomeAssistant, serial: str, jpeg: bytes) -> None:
    """
    Seed a camera's last-good snapshot from an out-of-band grab (executor job).

    Used by the config flow's frame check so a freshly added/reconfigured camera has a
    thumbnail immediately: the entity restores this frame on the reload that follows,
    instead of blocking the first image request on a slow live grab (which would blow
    past Home Assistant's image timeout and blank the tile).
    """
    _write_snapshot(_snapshot_path_for(hass, serial), jpeg)


async def async_setup_entry(
    hass: HomeAssistant,  # noqa: ARG001 - platform setup signature fixed by HA
    entry: EzvizStreamConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """Create a camera entity for each camera subentry of the account."""
    for subentry in entry.subentries.values():
        if subentry.subentry_type != CAMERA_SUBENTRY_TYPE:
            continue
        async_add_entities(
            [EzvizStreamCamera(entry, subentry)],
            config_subentry_id=subentry.subentry_id,
        )


class EzvizStreamCamera(Camera):
    """A cloud-streamed EZVIZ camera (one per subentry)."""

    _attr_has_entity_name = True
    # Sub-name so we compose to "<device> Cloud" and don't collide with the
    # official `ezviz` camera, which is the nameless primary entity on the same
    # device card (§6.3). Standalone, "<device> Cloud" is harmlessly redundant.
    _attr_name = "Cloud"
    _attr_supported_features = CameraEntityFeature.STREAM

    def __init__(self, entry: EzvizStreamConfigEntry, subentry: ConfigSubentry) -> None:
        """Initialise the camera from its account entry and camera subentry."""
        super().__init__()
        self._entry = entry
        self._serial: str = subentry.data[CONF_SERIAL]
        self._verification_code: str = subentry.data.get(CONF_VERIFICATION_CODE, "")
        self._thumbnail_mode: str = _resolve_thumbnail_mode(subentry.data)
        self._snapshot_interval: float = _resolve_interval(subentry.data)
        self._stream_index: int = subentry.data.get(CONF_STREAM, DEFAULT_STREAM)
        # Re-encode to H.264 on the shared session instead of copying native HEVC.
        # CPU-heavy; opt-in for when go2rtc's on-demand transcode isn't available.
        self._force_h264: bool = subentry.data.get(CONF_FORCE_H264, DEFAULT_FORCE_H264)
        # None until known (cameras added before this was recorded resolve it once).
        self._is_battery: bool | None = subentry.data.get(CONF_IS_BATTERY)
        # None until a control-plane lookup reports it. Drives `available` and the
        # offline fast-fail in stream_source (mains cameras only - see there).
        self._is_online: bool | None = None
        # static_motion: suppress motion images at/older than this epoch-seconds anchor.
        self._static_anchor: float = float(subentry.data.get(CONF_STATIC_ANCHOR) or 0.0)
        self._static_image: bytes | None = None  # the frozen baseline for static_motion
        self._capture_task: asyncio.Task[None] | None = None  # static refresh-on-view
        self._attr_unique_id = self._serial
        self._image: bytes | None = None  # last decoded frame (snapshot cache)
        self._image_at = 0.0
        self._image_lock = asyncio.Lock()  # dedupe concurrent grabs for this camera
        # Live serving: a random per-camera token guards the HTTP media endpoint, and
        # one on-demand broadcaster fans a single cloud session out to all consumers.
        self._token = secrets.token_urlsafe(32)
        self._broadcast = CameraBroadcast(self._make_source)
        # Reuse the official `ezviz` device identifier so we land on the same device
        # card when that integration is installed, and stand alone otherwise (§6.3).
        self._attr_device_info = DeviceInfo(
            identifiers={(OFFICIAL_EZVIZ_DOMAIN, self._serial)},
            name=subentry.title,
            manufacturer=MANUFACTURER,
            serial_number=self._serial,
        )

    def _make_source(self) -> AsyncIterator[bytes]:
        """Build the upstream MPEG-TS source (called when the broadcaster starts)."""
        api = self._entry.runtime_data.api
        return mpegts_source(
            api,
            self._serial,
            get_ffmpeg_manager(self.hass).binary,
            stream=self._stream_index,
            verification_code=self._verification_code,
            transcode=self._force_h264,
            # 中国区根据真实媒体识别格式，电池属性仅用于休眠和可用性判断。
            autodetect=self._entry.data.get("region") == "China",
        )

    @property
    def _snapshot_path(self) -> Path:
        """Path to this camera's persisted last-good frame."""
        return _snapshot_path_for(self.hass, self._serial)

    @property
    def _cache_ttl(self) -> float:
        """How long a cached frame stays fresh (the per-camera refresh interval)."""
        if self._thumbnail_mode == THUMBNAIL_STATIC:
            return float("inf")  # captured once, then never revalidated
        return self._snapshot_interval

    @property
    def extra_state_attributes(self) -> dict[str, bool | None]:
        """Read-only camera facts. `battery_camera` is None until first resolved."""
        return {"battery_camera": self._is_battery}

    @property
    def available(self) -> bool:
        """
        Mark a known-offline mains camera unavailable; keep others available.

        Battery cameras report "not online" while merely asleep, and streaming is how
        we wake them, so they are never marked unavailable on that basis. When online
        state is still unknown (None) we stay available and let a grab decide. A camera
        that is encrypted but has no verification code configured is also unavailable -
        its stream can only decode to garbage until the code is added (a repair issue
        asks the user to reconfigure).
        """
        if self._serial in self._entry.runtime_data.encrypted_without_code:
            return False
        return not (self._is_battery is False and self._is_online is False)

    def _set_online(self, *, online: bool) -> None:
        """Record the camera's online state and refresh HA state if it changed."""
        if online != self._is_online:
            self._is_online = online
            if self.entity_id:  # published only once the entity is fully added
                self.async_write_ha_state()

    async def _async_lookup_camera(self) -> EzvizCamera | None:
        """Find this camera on the account (a no-wake control-plane call)."""
        cameras = await self._entry.runtime_data.api.async_get_cameras()
        camera = next((c for c in cameras if c.serial == self._serial), None)
        if camera is not None:
            self._set_online(online=camera.is_online)
        return camera

    async def async_added_to_hass(self) -> None:
        """Register the broadcaster and restore the last frame as a failure fallback."""
        register_stream(
            self.hass,
            self._serial,
            self._token,
            self._broadcast,
            self._entry.runtime_data.api,
            self._verification_code,
        )
        # Restore for failure-fallback only: leave _image_at at 0 so the frame is
        # treated as stale and the next request still attempts a fresh grab, falling
        # back to the restored frame only if that grab fails (no cold-start blank).
        restored = await self.hass.async_add_executor_job(
            _read_snapshot, self._snapshot_path
        )
        if restored is not None and self._image is None:
            self._image = restored
        # For static_motion the persisted frame is the static baseline (alarm images
        # are never written to disk), so keep it available to fall back to.
        if restored is not None and self._thumbnail_mode == THUMBNAIL_STATIC_MOTION:
            self._static_image = restored
        # Cameras added before is_battery was recorded resolve it once, off the setup
        # path (a single cloud control-plane call - it does not wake the camera).
        if self._is_battery is None:
            self.hass.async_create_background_task(
                self._async_resolve_battery(),
                f"ezviz_stream resolve battery {self._serial}",
                eager_start=False,
            )

    async def _async_resolve_battery(self) -> None:
        """Look up whether this is a battery camera and publish it (never raises)."""
        try:
            cameras = await self._entry.runtime_data.api.async_get_cameras()
        except Exception:  # noqa: BLE001 - a background task must not leak
            _LOGGER.debug("Could not resolve battery status for %s", self._serial)
            return
        camera = next((c for c in cameras if c.serial == self._serial), None)
        if camera is not None:
            changed = camera.is_online != self._is_online
            self._is_online = camera.is_online
            if self._is_battery is None:
                self._is_battery = camera.is_battery
                changed = True
            if changed and self.entity_id:  # published once the entity is fully added
                self.async_write_ha_state()

    async def async_will_remove_from_hass(self) -> None:
        """
        Deregister and stop the broadcaster (runtime cleanup only).

        The persisted frame is intentionally left on disk: this hook runs on every
        unload/reload (including a restart), and the frame is the restart fallback. It
        is deleted only when the camera is actually removed (``async_remove_*`` in
        :mod:`__init__`), so a restart restores it instead of blanking the tile.
        """
        unregister_stream(self.hass, self._serial)
        await self._broadcast.async_stop()
        # Tear down the HA-level Stream too. The base Camera keeps a worker thread
        # (self.stream) that otherwise keeps retrying our now-removed media URL after
        # the entity is gone, so a delete/reload would leave an orphaned stream storm.
        if self.stream is not None:
            await self.stream.stop()
            self.stream = None
        await super().async_will_remove_from_hass()

    async def stream_source(self) -> str:
        """
        Return the local HTTP MPEG-TS URL that go2rtc and the stream component read.

        go2rtc rejects ``exec:`` sources via its API, and HA's ``stream`` component can
        only ffmpeg-open a URL, so we serve MPEG-TS from our own token-guarded view
        (:mod:`stream_view`). The broadcaster behind it fans one cloud session out to
        all consumers (WebRTC + HLS + snapshots), so only one stream runs per camera.
        """
        # Fast-fail an offline mains camera: otherwise HA spins up a stream worker
        # that retries our URL on a backoff for as long as a consumer is attached,
        # even after the camera is removed. Battery cameras are exempt - they report
        # "not online" while asleep, and opening a stream is exactly how we wake them.
        # A lookup failure fails open (we still try to stream).
        if self._is_battery is False:
            try:
                camera = await self._async_lookup_camera()
            except Exception:  # noqa: BLE001 - lookup failed; fall through and try
                camera = None
            if camera is not None and not camera.is_online:
                msg = f"Camera {self._serial} is offline; not starting a stream"
                raise HomeAssistantError(msg)
        port = self.hass.http.server_port
        # "Static image (refreshed when viewed)": now that a live view is opening, grab
        # a fresh thumbnail from the shared session it starts - no extra cloud session.
        if self._thumbnail_mode == THUMBNAIL_STATIC:
            self._schedule_stream_capture()
        return (
            f"http://127.0.0.1:{port}/api/ezviz_stream/{self._serial}"
            f"?token={self._token}"
        )

    async def async_camera_image(
        self,
        width: int | None = None,  # noqa: ARG002 - HA image API; we return native res
        height: int | None = None,  # noqa: ARG002
    ) -> bytes | None:
        """
        Return the cached frame, refreshing in the background; never block past 10 s.

        Stale-while-revalidate: a grab drives login -> handshake -> media -> decode and
        can take up to ``_SNAPSHOT_TIMEOUT`` (~30 s), but HA aborts an image request
        after ``CAMERA_IMAGE_TIMEOUT`` (10 s). So a held frame (fresh or stale, incl.
        one restored from disk) is returned at once and the refresh runs in the
        background. With no frame yet we wait only ``_COLD_GRAB_WAIT`` for the grab -
        under the 10 s cutoff and WITHOUT cancelling it, so a slow first grab keeps
        running in the background and populates the cache for the next request rather
        than being cancelled and lost (which would blank the tile forever).

        The ``static`` mode never refreshes on the request path: its frame is updated
        only when a live view opens (see :meth:`stream_source`), so it stays current at
        no cost and never wakes the camera just for a tile.
        """
        refreshable = self._thumbnail_mode != THUMBNAIL_STATIC
        if refreshable and (
            self._image is None or time.monotonic() - self._image_at >= self._cache_ttl
        ):
            task = self._schedule_snapshot_refresh()
            if self._image is None and task is not None:
                # asyncio.wait does not cancel the task on timeout, so a slow grab
                # survives to fill the cache even though we return None now.
                await asyncio.wait({task}, timeout=_COLD_GRAB_WAIT)
        return self._image

    def _schedule_snapshot_refresh(self) -> asyncio.Task[None] | None:
        """Kick a background snapshot grab unless one is already running; return it."""
        if self._image_lock.locked():
            return None
        # eager_start=False so the grab runs entirely off the request path - the
        # caller gets the cached frame back before any of the refresh runs.
        return self.hass.async_create_background_task(
            self._async_background_refresh(),
            f"ezviz_stream snapshot refresh {self._serial}",
            eager_start=False,
        )

    async def _async_background_refresh(self) -> None:
        """Refresh the snapshot cache off the request path (never raises)."""
        async with self._image_lock:
            if (
                self._image is not None
                and time.monotonic() - self._image_at < self._cache_ttl
            ):
                return  # another refresh beat us to it
            try:
                await self._async_grab_into_cache()
            except Exception:  # noqa: BLE001 - a background task must not leak
                _LOGGER.debug(
                    "Background snapshot refresh failed for %s",
                    self._serial,
                    exc_info=True,
                )

    async def _async_grab_into_cache(self) -> None:
        """Refresh the in-memory + on-disk cache with a new frame (holds the lock)."""
        if self._thumbnail_mode == THUMBNAIL_STATIC_MOTION:
            await self._async_static_then_motion()
            return
        if self._thumbnail_mode == THUMBNAIL_MOTION:
            jpeg = await self._async_fetch_motion_image()
            # If the motion image is blank and nothing is cached yet, seed the tile
            # with a single live grab; later refreshes stay on the (no-wake) image.
            if jpeg is None and self._image is None:
                jpeg = await self._async_grab_live()
        else:
            # interval + static both grab a live frame; static just never
            # revalidates afterwards (its cache TTL is infinite).
            jpeg = await self._async_grab_live()
        await self._store_frame(jpeg, persist=True)

    async def _async_static_then_motion(self) -> None:
        """
        Serve a static baseline, replaced by a motion image newer than the anchor.

        The baseline is grabbed once and persisted (its own frame on disk); alarm
        images are shown from memory only, so they never overwrite the baseline and a
        re-anchor (a config-flow save) cleanly falls back to the clean static frame.
        """
        if self._static_image is None:
            self._static_image = await self._async_grab_live()
            if self._static_image is not None:
                await self.hass.async_add_executor_job(
                    _write_snapshot, self._snapshot_path, self._static_image
                )
        motion = await self._async_fetch_motion_event()
        if motion is not None and motion.timestamp > self._static_anchor:
            await self._store_frame(motion.image, persist=False)  # newer alarm
        elif self._static_image is not None:
            await self._store_frame(self._static_image, persist=False)  # baseline

    async def _store_frame(self, jpeg: bytes | None, *, persist: bool) -> None:
        """Update the in-memory cache with a frame, optionally persisting it to disk."""
        if jpeg is None:
            return
        self._image = jpeg
        self._image_at = time.monotonic()
        if persist:
            await self.hass.async_add_executor_job(
                _write_snapshot, self._snapshot_path, jpeg
            )

    async def _async_fetch_motion_image(self) -> bytes | None:
        """Fetch the last cloud motion image for the thumbnail (no camera wake)."""
        api = self._entry.runtime_data.api
        return await api.async_get_last_motion_image(
            self._serial, verification_code=self._verification_code
        )

    async def _async_fetch_motion_event(self) -> MotionImage | None:
        """Fetch the last cloud motion image with its event time (no camera wake)."""
        api = self._entry.runtime_data.api
        return await api.async_get_last_motion(
            self._serial, verification_code=self._verification_code
        )

    async def _async_grab_live(self) -> bytes | None:
        """
        Grab one live frame, reusing a viewer's session when one is already up.

        If a live view is in progress we tap its shared broadcast instead of opening a
        second cloud session: EZVIZ limits concurrent streams per device, so a rival
        session preempts the live one and restarts the camera's day/night exposure
        ramp - seen as a grayscale->colour flip on the live video. Tapping reuses the
        one session (no wake, no collision). Only when nothing is watching do we open
        an independent, wake-and-retry session. When a tap yields nothing (a rare
        keyframe timeout) we skip this refresh rather than open a rival session.
        """
        if self._broadcast.is_running:
            return await self._capture_from_live_stream()

        api = self._entry.runtime_data.api
        camera = await self._async_lookup_camera()
        if camera is None:
            _LOGGER.warning("Camera %s not found on the account", self._serial)
            return None

        async with self._entry.runtime_data.snapshot_semaphore:
            return await grab_jpeg(
                camera,
                api.async_get_vtdu_token,
                get_ffmpeg_manager(self.hass).binary,
                stream=self._stream_index,
                verification_code=self._verification_code,
                duration=_SNAPSHOT_TIMEOUT,
                max_sessions=_SNAPSHOT_MAX_SESSIONS,
            )

    def _schedule_stream_capture(self) -> None:
        """Kick a thumbnail capture from the live view, unless one already runs."""
        if self._capture_task is not None and not self._capture_task.done():
            return
        self._capture_task = self.hass.async_create_background_task(
            self._async_capture_from_live(),
            f"ezviz_stream thumbnail capture {self._serial}",
            eager_start=False,
        )

    async def _capture_from_live_stream(self) -> bytes | None:
        """
        Decode one keyframe from an already-running live view, or None if idle.

        Taps the shared broadcast (``start_if_idle=False``) so it only reads a session
        a viewer already opened - it never starts one, so there is no extra cloud
        session or camera wake. FFmpeg pulls one *complete* keyframe from the live
        stream (see :func:`capture_jpeg_from_ts`), so the tile can never be a half
        frame; when nothing is streaming the source is empty and it returns None.
        """
        if not self._broadcast.is_running:
            # No live view in progress - HA calls stream_source() to register the
            # source at startup too, so don't spawn a decoder for an idle broadcast.
            return None
        async with contextlib.aclosing(
            self._broadcast.subscribe(start_if_idle=False)
        ) as stream:
            return await capture_jpeg_from_ts(
                get_ffmpeg_manager(self.hass).binary,
                stream,
                timeout=_STREAM_CAPTURE_KEYFRAME_TIMEOUT,
            )

    async def _async_capture_from_live(self) -> None:
        """Refresh the static thumbnail from the live view on open (never raises)."""
        await asyncio.sleep(_STREAM_CAPTURE_DELAY)  # let the viewer's session come up
        try:
            jpeg = await self._capture_from_live_stream()
            if jpeg is not None:
                await self._store_frame(jpeg, persist=True)
        except Exception:  # noqa: BLE001 - a background task must not leak
            _LOGGER.debug(
                "Live thumbnail capture failed for %s", self._serial, exc_info=True
            )

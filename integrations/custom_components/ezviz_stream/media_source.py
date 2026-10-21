"""
Media source: browse and play a camera's cloud-stored recordings.

Exposes each configured camera's EZVIZ cloud clips in Home Assistant's media
browser: root -> camera -> recordings. Listing is plain HTTPS (no camera wake).
Selecting a clip resolves to the token-guarded replay view
(:class:`~.stream_view.EzvizReplayView`), which streams the decrypted clip as
fragmented H.264 MP4.

The official ``ezviz`` integration has no recordings/playback, so this is net-add.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

# Import from the defining module: media_player re-exports these without an
# explicit __all__ entry, which mypy's no_implicit_reexport rejects.
from homeassistant.components.media_player.const import MediaClass, MediaType
from homeassistant.components.media_source import (
    BrowseMediaSource,
    MediaSource,
    MediaSourceItem,
    PlayMedia,
    Unresolvable,
)
from homeassistant.config_entries import ConfigEntryState

from .const import (
    CAMERA_SUBENTRY_TYPE,
    CONF_ENABLE_RECORDINGS,
    CONF_RECORDINGS_MODE,
    CONF_SERIAL,
    DEFAULT_ENABLE_RECORDINGS,
    DEFAULT_RECORDINGS_MODE,
    DOMAIN,
    RECORDINGS_MODE_DEFAULT,
    RECORDINGS_MODE_ON,
)
from .stream_view import replay_token

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import EzvizStreamConfigEntry
    from .api import EzvizCloudApi

_MIME_TYPE = "video/mp4"
_KIND_CLOUD = "cloud"
_KIND_SD = "sd"
_SD_SEARCH_HOURS = 24  # how far back to list SD-card segments
_SD_CLOCK_MARGIN_MS = 3_600_000  # extend past "now": camera clocks can run ahead
# media_content_id depths: serial / kind / id
_ID_DEPTH_KIND = 2
_ID_DEPTH_CLIP = 3


async def async_get_media_source(hass: HomeAssistant) -> MediaSource:
    """Set up the EZVIZ Stream recordings media source."""
    return EzvizRecordingsMediaSource(hass)


class EzvizRecordingsMediaSource(MediaSource):
    """Browse and resolve EZVIZ cloud recordings for playback."""

    name = "EZVIZ Recordings"

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the media source."""
        super().__init__(DOMAIN)
        self.hass = hass

    async def async_resolve_media(self, item: MediaSourceItem) -> PlayMedia:
        """Resolve a ``serial/kind/id`` clip to the token-guarded replay URL."""
        parts = item.identifier.split("/")
        if len(parts) != _ID_DEPTH_CLIP or parts[1] not in (_KIND_CLOUD, _KIND_SD):
            msg = f"Invalid EZVIZ recording id: {item.identifier!r}"
            raise Unresolvable(msg)
        serial, kind, ident = parts
        token = replay_token(self.hass, serial)
        if token is None:
            msg = f"Camera {serial} is not available for playback"
            raise Unresolvable(msg)
        url = f"/api/ezviz_stream/{serial}/replay/{kind}/{ident}?token={token}"
        return PlayMedia(url, _MIME_TYPE)

    async def async_browse_media(self, item: MediaSourceItem) -> BrowseMediaSource:
        """Browse cameras (root), a camera's sources, or a source's recordings."""
        if not item.identifier:
            return self._browse_root()
        parts = item.identifier.split("/")
        if len(parts) == 1:
            return self._browse_camera(parts[0])
        if len(parts) == _ID_DEPTH_KIND and parts[1] == _KIND_CLOUD:
            return await self._browse_cloud(parts[0])
        if len(parts) == _ID_DEPTH_KIND and parts[1] == _KIND_SD:
            return await self._browse_sd(parts[0])
        msg = f"{item.identifier!r} is not a browsable folder"
        raise Unresolvable(msg)

    def _folder(
        self,
        identifier: str | None,
        title: str,
        *,
        children: list[BrowseMediaSource] | None = None,
        children_class: MediaClass = MediaClass.VIDEO,
    ) -> BrowseMediaSource:
        """Build a browsable directory node."""
        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=identifier,
            media_class=MediaClass.DIRECTORY,
            media_content_type=MediaType.VIDEO,
            title=title,
            can_play=False,
            can_expand=True,
            children_media_class=children_class,
            children=children or [],
        )

    def _clip(self, identifier: str, title: str) -> BrowseMediaSource:
        """Build a playable recording leaf."""
        return BrowseMediaSource(
            domain=DOMAIN,
            identifier=identifier,
            media_class=MediaClass.VIDEO,
            media_content_type=MediaType.VIDEO,
            title=title,
            can_play=True,
            can_expand=False,
        )

    def _browse_root(self) -> BrowseMediaSource:
        """List every configured, loaded camera as a folder."""
        cameras = [
            self._folder(serial, title, children_class=MediaClass.DIRECTORY)
            for _entry, serial, title in self._cameras()
        ]
        return self._folder(
            None,
            "EZVIZ Recordings",
            children=cameras,
            children_class=MediaClass.DIRECTORY,
        )

    def _browse_camera(self, serial: str) -> BrowseMediaSource:
        """Show a camera's two recording sources: cloud and SD-card."""
        title = self._camera_title(serial)
        return self._folder(
            serial,
            title,
            children_class=MediaClass.DIRECTORY,
            children=[
                self._folder(f"{serial}/{_KIND_CLOUD}", "Cloud recordings"),
                self._folder(f"{serial}/{_KIND_SD}", "SD-card recordings"),
            ],
        )

    async def _browse_cloud(self, serial: str) -> BrowseMediaSource:
        """List a camera's cloud recordings, newest first."""
        api, channel, title = await self._camera_context(serial)
        recordings = await api.async_get_cloud_videos(serial, channel)
        clips = [
            self._clip(
                f"{serial}/{_KIND_CLOUD}/{rec.seq_id}",
                rec.start_time or rec.begin_cas or rec.seq_id,
            )
            for rec in recordings
        ]
        return self._folder(
            f"{serial}/{_KIND_CLOUD}", f"{title} - Cloud", children=clips
        )

    async def _browse_sd(self, serial: str) -> BrowseMediaSource:
        """List a camera's SD-card segments over the recent window."""
        api, channel, title = await self._camera_context(serial)
        now_ms = int(time.time() * 1000)
        recordings = await api.async_search_records(
            serial,
            channel,
            start_millis=now_ms - _SD_SEARCH_HOURS * 3_600_000,
            stop_millis=now_ms + _SD_CLOCK_MARGIN_MS,
        )
        clips = [
            self._clip(
                f"{serial}/{_KIND_SD}/{rec.begin_millis}-{rec.end_millis}", rec.label
            )
            for rec in recordings
        ]
        return self._folder(
            f"{serial}/{_KIND_SD}", f"{title} - SD card", children=clips
        )

    def _camera_title(self, serial: str) -> str:
        """Return a camera's title, or raise if it is unknown / not exposed."""
        match = next((c for c in self._cameras() if c[1] == serial), None)
        if match is None:
            msg = f"Unknown camera {serial}"
            raise Unresolvable(msg)
        return match[2]

    async def _camera_context(self, serial: str) -> tuple[EzvizCloudApi, int, str]:
        """Return (api, channel, title) for a serial, resolving the channel live."""
        match = next((c for c in self._cameras() if c[1] == serial), None)
        if match is None:
            msg = f"Unknown camera {serial}"
            raise Unresolvable(msg)
        entry, _serial, title = match
        api: EzvizCloudApi = entry.runtime_data.api
        camera = next(
            (c for c in await api.async_get_cameras() if c.serial == serial), None
        )
        channel = camera.channel if camera is not None else 1
        return api, channel, title

    def _cameras(self) -> list[tuple[EzvizStreamConfigEntry, str, str]]:
        """Return (entry, serial, title) for every camera of every loaded account."""
        out: list[tuple[EzvizStreamConfigEntry, str, str]] = []
        entries: list[EzvizStreamConfigEntry] = self.hass.config_entries.async_entries(
            DOMAIN
        )
        for entry in entries:
            if entry.state is not ConfigEntryState.LOADED:
                continue
            # Recordings in the media library are opt-in (off by default, for privacy).
            # The account setting is the default; each camera can override it.
            account_on = entry.options.get(
                CONF_ENABLE_RECORDINGS, DEFAULT_ENABLE_RECORDINGS
            )
            for subentry in entry.subentries.values():
                if subentry.subentry_type != CAMERA_SUBENTRY_TYPE:
                    continue
                serial = subentry.data.get(CONF_SERIAL)
                if not serial:
                    continue
                mode = subentry.data.get(CONF_RECORDINGS_MODE, DEFAULT_RECORDINGS_MODE)
                enabled = (
                    account_on
                    if mode == RECORDINGS_MODE_DEFAULT
                    else mode == RECORDINGS_MODE_ON
                )
                if enabled:
                    out.append((entry, serial, subentry.title or serial))
        return out

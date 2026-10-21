"""
Async EZVIZ cloud API client (control plane: login + camera discovery).

Just the HTTPS control-plane needed for the config flow and coordinator - the
VTM/VTDU media handshake lives in the streaming module (added with the camera
platform). Ported from the proven sync core in ``scripts/ezviz_cloud.py`` to async
on Home Assistant's shared ``aiohttp`` session.
"""

from __future__ import annotations

import asyncio
import base64
import datetime as dt
import hashlib
import json
import logging
import time
import zlib
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, NamedTuple
from urllib.parse import parse_qs, urlencode, urlparse

import aiohttp

from .const import BATTERY_CAMERA_CATEGORY, HIK_ENCRYPTION_HEADER, REGION_API_CODES
from .decrypt_image import StillImageDecryptError, decrypt_still_image

_LOGGER = logging.getLogger(__name__)

_REQUEST_TIMEOUT = 15
_HTTP_OK = 200
_NOT_LOGGED_IN = "not logged in"  # raised by control-plane calls before async_login
_EPOCH_MS_THRESHOLD = 1e12  # values above this are epoch milliseconds, not seconds
_LOGIN_PATH = "/v3/users/login/v5"
_PAGELIST_PATH = (
    "/v3/userdevices/v1/resources/pagelist"
    "?filter=VTM,STATUS&groupId=-1&limit=50&offset=0"  # STATUS carries isEncrypt
)
# Most recent motion/alarm event (with its stored still image); limit=1 = latest.
_ALARM_PATH = "/v3/alarms/v2/advanced?queryType=-1&limit=1&stype=-1&deviceSerials="

# Cloud recordings (playback): list stored clips, then fetch a per-clip playback
# ticket. The clip bytes themselves come over the cloud-replay socket (streaming
# module), not here - this is just the control plane (doc/reference.md, recordings).
_CLOUD_VIDEOS_PATH = "/v3/clouds/videos/list"
_CAMERA_TICKET_PATH = "/v3/cameras/ticketInfo"
_DEFAULT_CLOUD_LIMIT = 20
_CLOUD_VIDEO_TYPE = 2  # 2 = event/motion clips (the EZVIZ app default)
_DEFAULT_STORAGE_VERSION = 2
_CAS_TIME_FORMAT = "%Y%m%dT%H%M%SZ"  # EZVIZ "CAS" playback time (UTC), reference

# SD-card recordings: search the on-device record index over a time window. The
# clip bytes come over the ysproto /playback path (streaming module), not here.
_SD_RECORDS_PATH = "/v3/streaming/v2/records"
_DEFAULT_SD_SIZE = 20
_EPOCH_MS_DIGITS = 13  # a 13-digit integer string is epoch milliseconds
# The record search wants UTC "YYYY-MM-DD HH:MM:SS" strings; epoch/CAS give a device
# exception (2004). Verified live against a real camera.
_SEARCH_TIME_FORMAT = "%Y-%m-%d %H:%M:%S"

# Desktop/Studio client persona - load-bearing: the mobile persona doesn't reliably
# surface VTM routing data (doc/reference.md A.1/A.2).
_CLIENT: dict[str, str] = {
    "clientType": "9",
    "clientNo": "shipin7",
    "appId": "ys7",
    "customNo": "1000001",
    "clientVersion": "2,5,1,2109068",
    "featureCode": "0" * 32,
}

# EZVIZ login result codes we translate to typed errors (doc/reference.md A.3).
_MFA_CODE = 6002
_REGION_REDIRECT_CODE = 1100
_AUTH_ERROR_HINTS: dict[int, str] = {
    1013: "incorrect username",
    1014: "incorrect password",
    1015: "account locked",
    1069: "terminal-bind limit reached (prune terminals in the EZVIZ app)",
    1226: "incorrect credentials",
}


class EzvizStreamApiError(Exception):
    """Base error for the EZVIZ cloud client."""


# Names follow the Home Assistant config-flow convention (no "Error" suffix).
class CannotConnect(EzvizStreamApiError):  # noqa: N818
    """The cloud API was unreachable or returned an unusable response."""


class InvalidAuth(EzvizStreamApiError):  # noqa: N818
    """The account credentials were rejected."""


class MfaRequired(EzvizStreamApiError):  # noqa: N818
    """The account has two-step verification enabled (login code 6002)."""


class InvalidRegion(EzvizStreamApiError):  # noqa: N818
    """The configured region is not one we know how to route."""


@dataclass(slots=True)
class EzvizCamera:
    """A camera discovered on the account, with the fields relevant to streaming."""

    serial: str
    name: str
    category: str
    channel: int
    status: int | None
    streamable: bool
    vtm_ip: str | None = None
    vtm_port: int | None = None
    biz: str = ""  # streamBizUrl query fragment appended to the stream URL
    # STATUS.isEncrypt: True/False when known, None if the device didn't report it.
    is_encrypted: bool | None = None
    encrypt_pwd_hash: str = ""  # STATUS.encryptPwd - double-MD5 of the code (A.5)

    @property
    def is_online(self) -> bool:
        """Return True when the camera reports online (status 1)."""
        return self.status == 1

    @property
    def is_battery(self) -> bool:
        """Return True for a battery-powered camera (slow to wake)."""
        return self.category == BATTERY_CAMERA_CATEGORY

    @property
    def label(self) -> str:
        """A human-friendly label (the camera name, or the serial if unnamed)."""
        return self.name or self.serial

    @property
    def picker_label(self) -> str:
        """Config-flow picker label: 'Name (Serial)', or just the serial if unnamed."""
        return f"{self.name} ({self.serial})" if self.name else self.serial


@dataclass(slots=True)
class CloudRecording:
    """
    A cloud-stored clip discovered for a camera, with the fields playback needs.

    ``start_millis`` is the clip start as epoch milliseconds (None when the
    descriptor carried no parseable time); ``begin_cas``/``end_cas`` are the same
    range formatted for the cloud-replay open request. ``crypt`` marks a clip whose
    bytes are AES-encrypted (decrypted with the camera verification code, like the
    live IPC transport).
    """

    seq_id: str
    start_time: str  # raw descriptor string, e.g. "2026-07-16 10:30:00" (UTC)
    stop_time: str
    start_millis: int | None
    video_long: int  # clip duration in milliseconds
    file_size: int | None
    storage_version: int
    crypt: bool
    key_checksum: str
    stream_url: str | None  # "host:port" of the cloud-replay server, when present

    @property
    def stop_millis(self) -> int | None:
        """Clip end as epoch milliseconds (start + duration), or None if unknown."""
        if self.start_millis is None:
            return None
        return self.start_millis + self.video_long

    @property
    def begin_cas(self) -> str | None:
        """Clip start formatted as an EZVIZ CAS timestamp, or None if unknown."""
        return None if self.start_millis is None else _cas_time(self.start_millis)

    @property
    def end_cas(self) -> str | None:
        """Clip end formatted as an EZVIZ CAS timestamp, or None if unknown."""
        stop = self.stop_millis
        return None if stop is None else _cas_time(stop)


def _cas_time(millis: int) -> str:
    """Format epoch milliseconds as the UTC CAS timestamp the replay server expects."""
    return dt.datetime.fromtimestamp(millis / 1000, tz=dt.UTC).strftime(
        _CAS_TIME_FORMAT
    )


@dataclass(slots=True)
class SdRecording:
    """
    An SD-card recording segment: a ``[begin, end]`` window on the device.

    Played back over the ysproto ``/playback`` path (streaming module) using the CAS
    timestamps; there is no per-clip file/ticket like cloud recordings.
    """

    begin_millis: int
    end_millis: int
    record_type: int | None

    @property
    def begin_cas(self) -> str:
        """Segment start as an EZVIZ CAS timestamp."""
        return _cas_time(self.begin_millis)

    @property
    def end_cas(self) -> str:
        """Segment end as an EZVIZ CAS timestamp."""
        return _cas_time(self.end_millis)

    @property
    def duration_ms(self) -> int:
        """Segment length in milliseconds."""
        return max(0, self.end_millis - self.begin_millis)

    @property
    def label(self) -> str:
        """A readable UTC start time for a media-browser title."""
        return _search_time(self.begin_millis)


def _search_time(millis: int) -> str:
    """Format epoch milliseconds as the UTC datetime string the record search wants."""
    return dt.datetime.fromtimestamp(millis / 1000, tz=dt.UTC).strftime(
        _SEARCH_TIME_FORMAT
    )


def _record_millis(value: Any) -> int | None:
    """Parse a record timestamp (epoch s/ms, or a UTC date string) to epoch ms."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        ms = int(value)
        return ms if ms > _EPOCH_MS_THRESHOLD else ms * 1000
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            ms = int(text)
            return ms if len(text) >= _EPOCH_MS_DIGITS else ms * 1000
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y%m%dT%H%M%SZ"):
            with suppress(ValueError):
                naive = dt.datetime.strptime(text, fmt)  # noqa: DTZ007 - tz set next
                return int(naive.replace(tzinfo=dt.UTC).timestamp() * 1000)
    return None


def _decode_record_list(body: dict[str, Any]) -> list[Any]:
    """
    Return the record list from a search response (plain or base64+zlib JSON).

    The app compresses large record lists as a base64+zlib-encoded JSON string under
    one of several keys; smaller responses embed a plain list.
    """
    for key in ("records", "record", "files", "fileList", "videos", "videoList"):
        value = _deep_find(body, key)
        if isinstance(value, list):
            return value
        if isinstance(value, str) and value:
            with suppress(ValueError, zlib.error, UnicodeDecodeError):
                raw = zlib.decompress(base64.b64decode(value)).decode()
                decoded = json.loads(raw)
                if isinstance(decoded, list):
                    return decoded
    return []


def _as_int(value: Any) -> int | None:
    """Return ``value`` as an int if it is an int or a numeric string, else None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.lstrip("-").isdigit():
        return int(value)
    return None


def _sd_recording(item: dict[str, Any]) -> SdRecording | None:
    """Build an SdRecording from a record descriptor, or None if unusable."""
    begin = _record_millis(item.get("begin") or item.get("B") or item.get("startTime"))
    end = _record_millis(item.get("end") or item.get("E") or item.get("stopTime"))
    if begin is None or end is None or end <= begin:
        return None
    rec_type = item.get("type") or item.get("Type") or item.get("recordType")
    return SdRecording(
        begin_millis=begin,
        end_millis=end,
        record_type=_as_int(rec_type),
    )


def _api_host(region: str) -> str:
    # 中国区采用独立 API 域名，不能拼接国际区域名。
    if region == "China":
        return "https://api.ys7.com"
    code = REGION_API_CODES.get(region)
    if not code:
        raise InvalidRegion(region)
    return f"https://api{code}.ezvizlife.com"


def _headers(session_id: str | None = None) -> dict[str, str]:
    hdrs = {"User-Agent": "okhttp/3.12.1", "lang": "en", "netType": "WIFI", **_CLIENT}
    if session_id:
        hdrs["sessionId"] = session_id
    return hdrs


class MotionImage(NamedTuple):
    """A motion/alarm still image and its event time (epoch seconds, 0 if unknown)."""

    image: bytes
    timestamp: float


def _alarm_epoch(body: Any) -> float:
    """Return the latest alarm's event time as epoch seconds (0.0 if absent)."""
    raw = (
        _deep_find(body, "alarmTime")
        or _deep_find(body, "alarmStartTime")
        or _deep_find(body, "startTime")
    )
    try:
        seconds = float(raw)
    except TypeError, ValueError:
        return 0.0
    return seconds / 1000 if seconds > _EPOCH_MS_THRESHOLD else seconds


def _first_image_url(value: Any) -> str | None:
    """Return the first HTTP(S) URL from a picUrl-style value (may be ``;``-joined)."""
    if not isinstance(value, str):
        return None
    for part in value.split(";"):
        text = part.strip()
        if text.startswith(("http://", "https://")):
            return text
    return None


def _camera_from_resource(
    resource: dict[str, Any],
    vtm_map: dict[str, Any],
    dev_infos: dict[str, Any],
    status_map: dict[str, Any],
) -> EzvizCamera | None:
    """Build an EzvizCamera from a pagelist resource, or None if it is not a camera."""
    serial = resource.get("deviceSerial")
    if not serial or int(resource.get("resourceType", 0)) <= 0:
        return None
    vtm = vtm_map.get(resource.get("resourceId") or "") or {}
    info = dev_infos.get(serial, {})
    status = status_map.get(serial) or {}
    return EzvizCamera(
        serial=serial,
        name=resource.get("localName") or info.get("name") or "",
        category=info.get("deviceCategory", ""),
        channel=int(info.get("channelNumber") or 1),
        status=info.get("status"),
        streamable=bool(vtm.get("externalIp")),
        vtm_ip=vtm.get("externalIp"),
        vtm_port=int(vtm["port"]) if vtm.get("port") else None,
        biz=resource.get("streamBizUrl", ""),
        is_encrypted=bool(status["isEncrypt"]) if "isEncrypt" in status else None,
        encrypt_pwd_hash=str(status.get("encryptPwd") or ""),
    )


def _deep_find(obj: Any, key: str) -> Any:
    """Return the first truthy value for ``key`` anywhere in a nested dict/list."""
    if isinstance(obj, dict):
        if obj.get(key):
            return obj[key]
        for value in obj.values():
            if (found := _deep_find(value, key)) is not None:
                return found
    elif isinstance(obj, list):
        for value in obj:
            if (found := _deep_find(value, key)) is not None:
                return found
    return None


def _cloud_start_millis(video: dict[str, Any]) -> int | None:
    """
    Return a cloud clip's start time as epoch ms (reference: coverPic query first).

    The precise millisecond start lives in the ``coverPic`` URL's ``startTime``
    query param; the top-level ``startTime`` is a coarser UTC string fallback.
    """
    cover = video.get("coverPic")
    if isinstance(cover, str):
        values = parse_qs(urlparse(cover).query).get("startTime")
        if values:
            with suppress(ValueError):
                return int(values[0])
    start = video.get("startTime")
    if isinstance(start, str):
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            with suppress(ValueError):
                naive = dt.datetime.strptime(start, fmt)  # noqa: DTZ007 - tz set next
                return int(naive.replace(tzinfo=dt.UTC).timestamp() * 1000)
    if isinstance(start, int | float):
        return int(start)
    return None


def _cloud_recording(video: dict[str, Any]) -> CloudRecording | None:
    """Build a CloudRecording from a clip descriptor, or None if it has no seqId."""
    seq_id = video.get("seqId")
    if not seq_id:
        return None
    return CloudRecording(
        seq_id=str(seq_id),
        start_time=str(video.get("startTime") or ""),
        stop_time=str(video.get("stopTime") or ""),
        start_millis=_cloud_start_millis(video),
        video_long=int(video.get("videoLong") or 0),
        file_size=int(video["fileSize"]) if video.get("fileSize") else None,
        storage_version=int(video.get("storageVersion") or _DEFAULT_STORAGE_VERSION),
        crypt=bool(video.get("crypt")),
        key_checksum=str(video.get("keyChecksum") or ""),
        stream_url=video.get("streamUrl") or None,
    )


class EzvizCloudApi:
    """Minimal async EZVIZ cloud control-plane client."""

    def __init__(self, session: aiohttp.ClientSession, hass: Any = None, entry: Any = None) -> None:
        """Initialise with an externally-owned aiohttp session (HA's shared one)."""
        self._session = session
        self._session_id: str | None = None
        self._host: str | None = None
        self._auth_addr: str | None = None
        self._hass = hass
        self._username = ""
        self._entry = entry
        self._refresh_session_id: str | None = None
        self._refresh_lock = asyncio.Lock()

    def _sync_cn_session(self) -> bool:
        """复用同账号中国区集成维护的会话，跟随原集成的令牌刷新。"""
        if self._hass is None or self._host != "https://api.ys7.com":
            return False
        if self._entry is not None and self._entry.data.get("session_id"):
            self._session_id = self._entry.data["session_id"]
            self._refresh_session_id = self._entry.data.get("rf_session_id")
            return True
        for entry in self._hass.config_entries.async_entries("ezviz_cn"):
            if entry.data.get("username") == self._username and entry.data.get("session_id"):
                self._session_id = entry.data["session_id"]
                self._refresh_session_id = entry.data.get("rf_session_id")
                self._persist_cn_session()
                return True
        return False

    def _persist_cn_session(self) -> None:
        """将中国区会话保存在当前视频集成中，解除对旧集成的依赖。"""
        if self._entry is None or self._hass is None:
            return
        data = dict(self._entry.data)
        data.update(session_id=self._session_id, rf_session_id=self._refresh_session_id)
        if data != self._entry.data:
            self._hass.config_entries.async_update_entry(self._entry, data=data)

    async def async_refresh_cn_session(self) -> None:
        """通过官方刷新接口续期当前会话，并保存轮换后的刷新令牌。"""
        if not self._refresh_session_id:
            raise InvalidAuth("No EZVIZ refresh session is available")
        async with self._refresh_lock:
            body = await self._request("PUT", f"{self._host}/v3/apigateway/login", data={
                "refreshSessionId": self._refresh_session_id,
                "featureCode": _CLIENT["featureCode"],
            })
            if (body.get("meta") or {}).get("code") != 200:
                _LOGGER.warning("EZVIZ session refresh failed; authentication is required")
                raise InvalidAuth("EZVIZ session refresh failed")
            info = body.get("sessionInfo") or body.get("loginSession") or {}
            session_id = info.get("sessionId")
            refresh_id = info.get("refreshSessionId") or info.get("rfSessionId")
            if not session_id or not refresh_id:
                _LOGGER.error("EZVIZ session refresh returned incomplete credentials")
                raise CannotConnect("EZVIZ session refresh response is incomplete")
            self._session_id = session_id
            self._refresh_session_id = refresh_id
            self._persist_cn_session()

    def _cn_session_expires_soon(self) -> bool:
        """从会话有效期判断是否需要提前续期，不记录令牌内容。"""
        if not self._session_id:
            return True
        try:
            encoded = self._session_id.split(".")[1]
            payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
            return float(payload.get("exp", 0)) <= time.time() + 300
        except (ValueError, IndexError, TypeError):
            _LOGGER.debug("EZVIZ session expiry is unavailable; refreshing session")
            return True

    async def async_login(self, email: str, password: str, region: str) -> None:
        """
        Authenticate and cache the session id + resolved API host.

        Raises InvalidAuth, MfaRequired, CannotConnect, or InvalidRegion.
        """
        host = _api_host(region)
        self._host = host
        self._username = email
        # 已配置的中国区账号继续使用原集成已验证并持续刷新的会话。
        if region == "China" and self._sync_cn_session():
            if self._entry is not None and self._refresh_session_id:
                await self.async_refresh_cn_session()
            await self.async_get_cameras()
            return
        pwd_md5 = hashlib.md5(password.encode(), usedforsecurity=False).hexdigest()
        data = {
            "account": email,
            "password": pwd_md5,
            "featureCode": _CLIENT["featureCode"],
            "msgType": "0",
            "cuName": base64.b64encode(b"hass-ezviz-stream").decode(),
        }

        # 中国区使用 iOS 登录协议和响应结构。
        login_path = _LOGIN_PATH
        if region == "China":
            login_path = "/v3/users/login/v3"
            data.update({"bizType": "", "cuName": "SGFzc2lv"})
        for _attempt in range(2):  # one region-redirect (1100) retry
            body = await self._post(f"{host}{login_path}", data)
            code = (body.get("meta") or {}).get("code")
            if code == _HTTP_OK:
                self._store_session(body, host)
                return
            if code == _REGION_REDIRECT_CODE:
                host = _redirect_host(body)
                continue
            if code == _MFA_CODE:
                raise MfaRequired
            raise InvalidAuth(_AUTH_ERROR_HINTS.get(code or -1, f"login code {code}"))
        msg = "exhausted region-redirect retries"
        raise CannotConnect(msg)

    def _store_session(self, body: dict[str, Any], fallback_host: str) -> None:
        """Cache the session id + resolved host from a successful login body."""
        session_id = (body.get("loginSession") or body.get("sessionInfo") or {}).get("sessionId")
        if not session_id:
            msg = "login succeeded but no session id returned"
            raise CannotConnect(msg)
        new_host = (body.get("loginArea") or {}).get("apiDomain")
        self._host = _normalise_host(new_host) or fallback_host
        self._session_id = session_id

    async def async_get_cameras(self) -> list[EzvizCamera]:
        """Return the streamable cameras on the account. Requires a prior login."""
        if not self._session_id or not self._host:
            raise EzvizStreamApiError(_NOT_LOGGED_IN)
        # 保留资源列表的 VTM 路由；中国区 relay 接口不能替代此路由。
        if self._host == "https://api.ys7.com":
            body = await self._get(
                f"{self._host}/v3/devices/resources?filter=VTM,STATUS,CONNECTION,FEATURE_INFO,STREAM_STATUS&groupId=-1&limit=50&offset=0"
            )
            body = _normalise_cn_resources(body)
        else:
            body = await self._get(f"{self._host}{_PAGELIST_PATH}")

        vtm_map = _deep_find(body, "VTM") or {}
        status_map = _deep_find(body, "STATUS") or {}
        dev_infos = {
            di["deviceSerial"]: di
            for di in (_deep_find(body, "deviceInfos") or [])
            if di.get("deviceSerial")
        }
        return [
            camera
            for resource in _deep_find(body, "resourceInfos") or []
            if (
                camera := _camera_from_resource(
                    resource, vtm_map, dev_infos, status_map
                )
            )
            and camera.streamable
        ]

    async def async_get_last_motion(
        self, serial: str, *, verification_code: str = ""
    ) -> MotionImage | None:
        """
        Return the most recent motion/alarm image and its event time, or None.

        Fetched over plain HTTPS from the alarms API (reference A.8.1): no VTDU
        session and no camera wake, so it is safe as a battery camera's thumbnail.
        A payload wrapped in the ``hikencodepicture`` envelope is decrypted with the
        verification code (reference B.10.2); a wrong code yields None. The event time
        is epoch seconds (0.0 if the alarm carried none).
        """
        if not self._session_id or not self._host:
            raise EzvizStreamApiError(_NOT_LOGGED_IN)
        body = await self._get(f"{self._host}{_ALARM_PATH}{serial}")
        if (body.get("meta") or {}).get("code") != _HTTP_OK:
            return None
        image_url = _first_image_url(
            _deep_find(body, "picUrl") or _deep_find(body, "picURL")
        )
        if not image_url:
            return None
        data = await self._get_bytes(image_url)
        if not data:
            return None
        if HIK_ENCRYPTION_HEADER in data:
            try:
                # Decrypt off the event loop - AES over a full JPEG is CPU-heavy and
                # would otherwise stall Home Assistant on every thumbnail refresh.
                data = await asyncio.to_thread(
                    decrypt_still_image, data, verification_code
                )
            except StillImageDecryptError:
                _LOGGER.debug("Could not decrypt motion image (check code)")
                return None
        return MotionImage(image=data, timestamp=_alarm_epoch(body))

    async def async_get_last_motion_image(
        self, serial: str, *, verification_code: str = ""
    ) -> bytes | None:
        """Return just the latest motion image (see :meth:`async_get_last_motion`)."""
        motion = await self.async_get_last_motion(
            serial, verification_code=verification_code
        )
        return motion.image if motion else None

    async def async_get_vtdu_token(self) -> str:
        """Fetch a VTDU media token (needed per streaming session). Requires login."""
        if not self._session_id or not self._host:
            raise EzvizStreamApiError(_NOT_LOGGED_IN)
        # 先完成续期，再使用当前令牌构造带签名的取流请求。
        if self._entry is not None and self._host == "https://api.ys7.com" and self._cn_session_expires_soon():
            await self.async_refresh_cn_session()
        auth_addr = await self._async_auth_addr()
        # sign = the `s` claim from the sessionId JWT payload (reference A.6).
        payload_seg = self._session_id.split(".")[1]
        payload_seg += "=" * (-len(payload_seg) % 4)  # base64url padding
        try:
            sign = json.loads(base64.urlsafe_b64decode(payload_seg))["s"]
        except (ValueError, KeyError) as err:
            msg = "session id is not a decodable JWT"
            raise CannotConnect(msg) from err
        url = f"{auth_addr}/vtdutoken2?ssid={self._session_id}&sign={sign}"
        body = await self._get(url)
        tokens = body.get("tokens") or []
        if not tokens:
            msg = f"no VTDU tokens returned (retcode={body.get('retcode')})"
            raise CannotConnect(msg)
        return str(tokens[0])

    async def async_get_cloud_videos(
        self,
        serial: str,
        channel: int,
        *,
        limit: int = _DEFAULT_CLOUD_LIMIT,
        video_type: int = _CLOUD_VIDEO_TYPE,
    ) -> list[CloudRecording]:
        """
        Return the camera's cloud-stored clips, newest first. Requires a login.

        Plain HTTPS (no VTDU session, no camera wake), so it is safe for battery
        cameras. The returned descriptors feed the media browser and, per clip, the
        cloud-replay playback session. An empty list means the API reported no clips.
        """
        if not self._session_id or not self._host:
            raise EzvizStreamApiError(_NOT_LOGGED_IN)
        query = urlencode(
            {
                "deviceSerial": serial,
                "channelNo": channel,
                "limit": limit,
                "videoType": video_type,
            }
        )
        body = await self._get(f"{self._host}{_CLOUD_VIDEOS_PATH}?{query}")
        if (body.get("meta") or {}).get("code") != _HTTP_OK:
            return []
        return [
            recording
            for video in _deep_find(body, "videos") or []
            if isinstance(video, dict) and (recording := _cloud_recording(video))
        ]

    async def async_get_camera_ticket(self, serial: str, channel: int) -> str:
        """Fetch the per-camera playback ticket for cloud-replay. Requires a login."""
        if not self._session_id or not self._host:
            raise EzvizStreamApiError(_NOT_LOGGED_IN)
        query = urlencode(
            {
                "deviceSerial": serial,
                "channelNo": channel,
                "supportMultiChannelSharedService": 0,
            }
        )
        body = await self._get(f"{self._host}{_CAMERA_TICKET_PATH}?{query}")
        info = _deep_find(body, "ticketInfo")
        ticket = info.get("ticket") if isinstance(info, dict) else None
        if not ticket:
            msg = "no camera playback ticket returned"
            raise CannotConnect(msg)
        return str(ticket)

    async def async_search_records(
        self,
        serial: str,
        channel: int,
        *,
        start_millis: int,
        stop_millis: int,
        size: int = _DEFAULT_SD_SIZE,
    ) -> list[SdRecording]:
        """
        Return SD-card recording segments within a time window. Requires a login.

        Plain HTTPS against the device record index (no camera wake). The window is
        given/returned in epoch milliseconds; each segment plays back over the
        ysproto ``/playback`` path. An empty list means no SD footage in the window.
        """
        if not self._session_id or not self._host:
            raise EzvizStreamApiError(_NOT_LOGGED_IN)
        query = urlencode(
            {
                "deviceSerial": serial,
                "channelNo": channel,
                "startTime": _search_time(start_millis),
                "stopTime": _search_time(stop_millis),
                "size": size,
                "sortBy": 0,
                "requireLabel": 0,
            }
        )
        body = await self._get(f"{self._host}{_SD_RECORDS_PATH}?{query}")
        meta = body.get("meta") or {}
        if meta.get("code") != _HTTP_OK:
            # 2003 = device offline, 2004 = device exception. SD playback needs the
            # camera reachable (it streams from the device), unlike cloud recordings.
            _LOGGER.debug(
                "SD record search for %s returned no records (meta=%s)", serial, meta
            )
            return []
        return [
            recording
            for item in _decode_record_list(body)
            if isinstance(item, dict) and (recording := _sd_recording(item))
        ]

    async def _async_auth_addr(self) -> str:
        """Resolve (and cache) the auth-node host for token requests."""
        if self._auth_addr is not None:
            return self._auth_addr
        try:
            # 中国区在系统配置接口返回取流授权服务器。
            if self._host == "https://api.ys7.com":
                body = await self._get(f"{self._host}/v3/configurations/system/info")
            else:
                body = await self._post(
                    f"{self._host}/api/server/info/get",
                    {
                        "sessionId": self._session_id or "",
                        "clientType": _CLIENT["clientType"],
                    },
                )
            auth = _normalise_host(_deep_find(body, "authAddr"))
        except CannotConnect:
            auth = None
        resolved = auth or self._host
        if resolved is None:  # only reachable if called before login (host unset)
            raise EzvizStreamApiError(_NOT_LOGGED_IN)
        self._auth_addr = resolved
        return resolved

    def _request_headers(self) -> dict[str, str]:
        """为中国区请求补齐 iOS 会话头，国际区保持原行为。"""
        headers = _headers(self._session_id)
        if self._host == "https://api.ys7.com":
            headers.update({
                "User-Agent": "VideoGo/7.7.3 (iPhone; iOS 26.5; Scale/3.00)",
                "clientType": "1", "clientNo": "", "clientVersion": "",
                "ssid": self._session_id or "", "sessionId": self._session_id or "",
            })
        return headers

    async def _post(self, url: str, data: dict[str, str]) -> dict[str, Any]:
        return await self._request("post", url, data=data)

    async def _get(self, url: str) -> dict[str, Any]:
        return await self._request("get", url)

    async def _get_bytes(self, url: str) -> bytes | None:
        """GET raw binary content (e.g. an alarm image); None on any failure."""
        try:
            async with asyncio.timeout(_REQUEST_TIMEOUT):
                resp = await self._session.get(url, headers=_headers(self._session_id))
                if resp.status != _HTTP_OK:
                    return None
                return await resp.read()
        except TimeoutError, aiohttp.ClientError:
            return None

    async def _request(
        self, method: str, url: str, *, data: dict[str, str] | None = None
    ) -> dict[str, Any]:
        self._sync_cn_session()
        # 刷新接口不能递归触发自身；其余请求在过期前自动续期。
        if self._entry is not None and self._host == "https://api.ys7.com" and self._refresh_session_id and not url.endswith("/v3/apigateway/login") and self._cn_session_expires_soon():
            await self.async_refresh_cn_session()
        try:
            async with asyncio.timeout(_REQUEST_TIMEOUT):
                resp = await self._session.request(
                    method, url, data=data, headers=self._request_headers()
                )
                # EZVIZ sometimes serves JSON with a non-JSON content-type.
                body = await resp.json(content_type=None)
        except (TimeoutError, aiohttp.ClientError) as err:
            raise CannotConnect(str(err)) from err
        except ValueError as err:  # non-JSON body
            msg = "cloud API returned a non-JSON response"
            raise CannotConnect(msg) from err
        if not isinstance(body, dict):
            msg = "cloud API returned an unexpected payload"
            raise CannotConnect(msg)
        return body


def _normalise_cn_resources(body: dict[str, Any]) -> dict[str, Any]:
    """映射中国区设备列表，并保留每个通道的取流业务参数。"""
    resources = [dict(resource) for resource in body.get("resources", [])]
    cameras = {camera.get("cameraId") or camera.get("resourceId"): camera
               for camera in body.get("cameraInfos", []) if isinstance(camera, dict)}
    vtms: dict[str, Any] = {}
    for resource in resources:
        camera = cameras.get(resource.get("resourceId"), {})
        if camera.get("streamBizUrl"):
            resource["streamBizUrl"] = camera["streamBizUrl"]
        if camera.get("vtmInfo"):
            vtms[resource.get("resourceId", "")] = camera["vtmInfo"]
    return {**body, "resourceInfos": resources, "VTM": vtms,
            "STATUS": body.get("statusInfos", {})}


def _normalise_host(host: str | None) -> str | None:
    if not host:
        return None
    return host if host.startswith("http") else f"https://{host}"


def _redirect_host(body: dict[str, Any]) -> str:
    """Return the retry host from a region-redirect (1100) login body."""
    area = body.get("loginArea") or {}
    new_host = _normalise_host(area.get("apiDomain"))
    if not new_host:
        msg = "region redirect without a host to retry"
        raise CannotConnect(msg)
    return new_host

"""Constants for the EZVIZ Stream integration."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "ezviz_stream"

# Account config-entry keys (username/password come from homeassistant.const).
CONF_REGION: Final = "region"
# Account-level tuning (options flow): how many camera thumbnails may refresh from
# the cloud at once. A burst of grabs (a dashboard of camera cards cold-loading) can
# overwhelm EZVIZ's signalling with churn (result 5405), so 1 - serialise them - is
# the safest default; the last-motion-thumbnail option cuts battery-cam load further.
# Raise cautiously if multi-camera thumbnail fill is too slow; back off if the hard
# concurrency codes (5504/5546) appear. Gates only snapshot grabs - live streams are
# one cloud session per camera and ungated.
CONF_MAX_SNAPSHOTS: Final = "max_concurrent_snapshots"
DEFAULT_MAX_SNAPSHOTS: Final = 1
MAX_MAX_SNAPSHOTS: Final = 5

# Account-level toggle: expose this account's cloud recordings in the HA media
# library (media_source). OFF by default - the media library is broadly visible, so
# surfacing recordings there is opt-in for privacy. Enable it in the account options.
CONF_ENABLE_RECORDINGS: Final = "enable_recordings"
DEFAULT_ENABLE_RECORDINGS: Final = False

# Per-camera override of the account-level recordings toggle. "default" follows the
# account setting; "on"/"off" force it for this camera regardless of the account.
CONF_RECORDINGS_MODE: Final = "recordings_mode"
RECORDINGS_MODE_DEFAULT: Final = "default"
RECORDINGS_MODE_ON: Final = "on"
RECORDINGS_MODE_OFF: Final = "off"
DEFAULT_RECORDINGS_MODE: Final = RECORDINGS_MODE_DEFAULT

# Camera subentries: the account is the config entry; each camera is a subentry
# carrying its own serial and (optional) Image-Encryption verification code.
CAMERA_SUBENTRY_TYPE: Final = "camera"
CONF_SERIAL: Final = "serial"
CONF_VERIFICATION_CODE: Final = "verification_code"
# Cached at add time: is this a battery-powered camera? Exposed read-only on the
# entity and in the config flow. Stored so it needs no repeated cloud lookup; the
# entity self-resolves it once for cameras added before this was recorded.
CONF_IS_BATTERY: Final = "is_battery"
# Cached at add time: does the device have Image Encryption on (STATUS.isEncrypt)?
# When set, the verification code becomes required in the config flow.
CONF_IS_ENCRYPTED: Final = "is_encrypted"
# Deprecated boolean cadence flag (kept only so subentries created before the
# explicit interval landed still map to a sensible TTL on read). Superseded by
# CONF_SNAPSHOT_INTERVAL; no longer written by the config flow.
CONF_SLOW_THUMBNAILS: Final = "slow_thumbnails"
# How often a *viewed* thumbnail refreshes (cache TTL, seconds). Each refresh of a
# non-motion thumbnail is a full cloud session that wakes a battery camera, so the
# battery default is deliberately long; mains cameras can afford a short interval.
# User-overridable per camera in the subentry flow's Advanced section.
CONF_SNAPSHOT_INTERVAL: Final = "snapshot_interval"
DEFAULT_SNAPSHOT_INTERVAL: Final = 30
DEFAULT_SNAPSHOT_INTERVAL_BATTERY: Final = 600
MIN_SNAPSHOT_INTERVAL: Final = 15
MAX_SNAPSHOT_INTERVAL: Final = 21600  # 6 h - for battery cams woken very rarely
# How the camera tile is filled. Superseded the CONF_MOTION_THUMBNAIL boolean:
#   interval      - a live snapshot refreshed every CONF_SNAPSHOT_INTERVAL (wakes
#                   battery cams);
#   motion        - the latest cloud motion image, no wake (reference A.8.1);
#   static        - refreshed from the live view whenever a stream opens (tapping the
#                   already-running broadcast, no extra cloud session), else the last
#                   captured frame;
#   static_motion - a static baseline, replaced by a motion image only when the event
#                   is newer than CONF_STATIC_ANCHOR (re-set on each save).
CONF_THUMBNAIL_MODE: Final = "thumbnail_mode"
THUMBNAIL_INTERVAL: Final = "interval"
THUMBNAIL_MOTION: Final = "motion"
THUMBNAIL_STATIC: Final = "static"
THUMBNAIL_STATIC_MOTION: Final = "static_motion"
# Epoch-seconds anchor for THUMBNAIL_STATIC_MOTION: motion images older than this are
# suppressed. Set to "now" on every save, so reconfiguring dismisses a stale/unwanted
# alarm image while still letting newer events through.
CONF_STATIC_ANCHOR: Final = "static_anchor"
# Deprecated boolean (True -> motion, False -> interval); read only for subentries
# created before CONF_THUMBNAIL_MODE. No longer written by the config flow.
CONF_MOTION_THUMBNAIL: Final = "motion_thumbnail"
# Marker prefix of an encrypted still image (alarm snapshot); see reference B.10.2.
HIK_ENCRYPTION_HEADER: Final = b"hikencodepicture"
# Which track to stream/snapshot: main (1, HD) or sub (2, lower-res, less bandwidth).
CONF_STREAM: Final = "stream"
MAIN_STREAM: Final = 1
SUB_STREAM: Final = 2
DEFAULT_STREAM: Final = MAIN_STREAM

# Transcode the shared live session to H.264 instead of copying the camera's native
# HEVC. Off by default: HA's built-in go2rtc converts HEVC->H.264 for browsers on
# demand, so the copy path stays CPU-free. Enable only when that path is unavailable
# (no go2rtc, or HEVC over WebRTC won't play) - it makes FFmpeg re-encode continuously
# per viewed camera, which is CPU-heavy (roughly a core per 1080p camera).
CONF_FORCE_H264: Final = "force_h264"
DEFAULT_FORCE_H264: Final = False

DEFAULT_REGION: Final = "Europe"

# EZVIZ ``deviceCategory`` for battery-powered cameras (matches pyezvizapi's
# DeviceCatagories.BATTERY_CAMERA_DEVICE_CATEGORY).
BATTERY_CAMERA_CATEGORY: Final = "BatteryCamera"

# Domain of the official Home Assistant `ezviz` integration. We reuse its device
# identifier so our camera lands on the same device card when it is installed, and
# stand alone (our own device) when it isn't (spec §6.3).
OFFICIAL_EZVIZ_DOMAIN: Final = "ezviz"
MANUFACTURER: Final = "EZVIZ"

# EZVIZ account region -> API host code (`api<code>.ezvizlife.com`). South Africa
# routes through the Europe node (see doc/reference.md A.1).
REGION_API_CODES: Final[dict[str, str]] = {
    "China": "china",
    "Europe": "ieu",
    "Africa": "ieu",
    "Asia": "isgp",
    "Singapore": "isgp",
    "India": "iindia",
    "NorthAmerica": "ius",
    "Oceania": "ius",
    "SouthAmerica": "isa",
}

"""
Config flow for EZVIZ Stream.

The account is the config entry (a hub); each camera is a config subentry carrying
its own serial and optional Image-Encryption verification code, added from the
account's "Add camera" action.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

import voluptuous as vol
from homeassistant.components.ffmpeg import get_ffmpeg_manager
from homeassistant.config_entries import (
    ConfigEntryState,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentryFlow,
    OptionsFlow,
    SubentryFlowResult,
)
from homeassistant.const import CONF_PASSWORD, CONF_USERNAME
from homeassistant.core import callback
from homeassistant.data_entry_flow import section
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    BooleanSelector,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)
from homeassistant.util import dt as dt_util

from .api import (
    CannotConnect,
    EzvizCamera,
    EzvizCloudApi,
    InvalidAuth,
    InvalidRegion,
    MfaRequired,
)
from .camera import persist_snapshot
from .const import (
    CAMERA_SUBENTRY_TYPE,
    CONF_ENABLE_RECORDINGS,
    CONF_FORCE_H264,
    CONF_IS_BATTERY,
    CONF_IS_ENCRYPTED,
    CONF_MAX_SNAPSHOTS,
    CONF_MOTION_THUMBNAIL,
    CONF_RECORDINGS_MODE,
    CONF_REGION,
    CONF_SERIAL,
    CONF_SLOW_THUMBNAILS,
    CONF_SNAPSHOT_INTERVAL,
    CONF_STATIC_ANCHOR,
    CONF_STREAM,
    CONF_THUMBNAIL_MODE,
    CONF_VERIFICATION_CODE,
    DEFAULT_ENABLE_RECORDINGS,
    DEFAULT_FORCE_H264,
    DEFAULT_MAX_SNAPSHOTS,
    DEFAULT_RECORDINGS_MODE,
    DEFAULT_REGION,
    DEFAULT_SNAPSHOT_INTERVAL,
    DEFAULT_SNAPSHOT_INTERVAL_BATTERY,
    DEFAULT_STREAM,
    DOMAIN,
    MAIN_STREAM,
    MAX_MAX_SNAPSHOTS,
    MAX_SNAPSHOT_INTERVAL,
    MIN_SNAPSHOT_INTERVAL,
    RECORDINGS_MODE_DEFAULT,
    RECORDINGS_MODE_OFF,
    RECORDINGS_MODE_ON,
    REGION_API_CODES,
    SUB_STREAM,
    THUMBNAIL_INTERVAL,
    THUMBNAIL_MOTION,
    THUMBNAIL_STATIC,
    THUMBNAIL_STATIC_MOTION,
)
from .decrypt_image import password_hash
from .stream import grab_jpeg

if TYPE_CHECKING:
    from collections.abc import Mapping

    from homeassistant.config_entries import ConfigEntry, ConfigSubentry

    from . import EzvizStreamConfigEntry

_LOGGER = logging.getLogger(__name__)

# Collapsible section key for the non-essential camera settings.
_ADVANCED = "advanced"
# A config-time frame grab confirms the verification code + stream selection. It
# drives a full cloud session (slow, and prone to transient cloud/battery hiccups),
# so a failed grab is a soft block: the user can retry or save anyway.
_VERIFY_TIMEOUT = 30.0
_VERIFY_MAX_SESSIONS = 3


def _camera_options_schema(  # noqa: PLR0913 - one form field per editable setting
    *,
    verification_code: str,
    is_encrypted: bool | None,
    thumbnail_mode: str,
    snapshot_interval: int,
    stream: int,
    force_h264: bool,
    recordings_mode: str,
) -> vol.Schema:
    """
    Build the schema for a camera's editable settings (add + reconfigure).

    The verification code is always shown. It is *required* when encryption is on,
    and *optional* otherwise (unencrypted or unknown status) - an unencrypted camera
    still accepts a code so older recordings from a period when encryption was enabled
    can be decrypted (see ``_code_hint``). The thumbnail source, refresh interval, and
    stream (all with sensible defaults) live in a collapsed 'advanced' section.
    """
    schema: dict[Any, Any] = {}
    code_key = vol.Required if is_encrypted else vol.Optional
    schema[code_key(CONF_VERIFICATION_CODE, default=verification_code)] = TextSelector(
        TextSelectorConfig(type=TextSelectorType.PASSWORD)
    )
    schema[vol.Required(_ADVANCED)] = section(
        vol.Schema(
            {
                vol.Required(
                    CONF_THUMBNAIL_MODE, default=thumbnail_mode
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=[
                            SelectOptionDict(
                                value=THUMBNAIL_INTERVAL,
                                label="Live snapshot (refreshed on a schedule)",
                            ),
                            SelectOptionDict(
                                value=THUMBNAIL_MOTION,
                                label="Latest motion image (no camera wake)",
                            ),
                            SelectOptionDict(
                                value=THUMBNAIL_STATIC,
                                label="Static image (refreshed when viewed)",
                            ),
                            SelectOptionDict(
                                value=THUMBNAIL_STATIC_MOTION,
                                label="Static, then newer motion images",
                            ),
                        ],
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Required(
                    CONF_SNAPSHOT_INTERVAL, default=snapshot_interval
                ): NumberSelector(
                    NumberSelectorConfig(
                        min=MIN_SNAPSHOT_INTERVAL,
                        max=MAX_SNAPSHOT_INTERVAL,
                        step=15,
                        mode=NumberSelectorMode.BOX,
                        unit_of_measurement="seconds",
                    )
                ),
                vol.Required(CONF_STREAM, default=str(stream)): SelectSelector(
                    SelectSelectorConfig(
                        options=[
                            SelectOptionDict(value=str(MAIN_STREAM), label="Main (HD)"),
                            SelectOptionDict(
                                value=str(SUB_STREAM), label="Sub (lower-res)"
                            ),
                        ],
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
                vol.Required(CONF_FORCE_H264, default=force_h264): BooleanSelector(),
                vol.Required(
                    CONF_RECORDINGS_MODE, default=recordings_mode
                ): SelectSelector(
                    SelectSelectorConfig(
                        options=[
                            SelectOptionDict(
                                value=RECORDINGS_MODE_DEFAULT,
                                label="Use account default",
                            ),
                            SelectOptionDict(
                                value=RECORDINGS_MODE_ON,
                                label="Show recordings in media library",
                            ),
                            SelectOptionDict(
                                value=RECORDINGS_MODE_OFF,
                                label="Hide recordings from media library",
                            ),
                        ],
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
            }
        ),
        {"collapsed": True},
    )
    return vol.Schema(schema)


def _flatten_options(user_input: dict[str, Any]) -> dict[str, Any]:
    """Merge the collapsed 'advanced' section back into a flat dict."""
    flat = {key: value for key, value in user_input.items() if key != _ADVANCED}
    flat.update(user_input.get(_ADVANCED, {}))
    return flat


def _camera_note(*, is_battery: bool) -> str:
    """Return a per-camera-type note for the add-form description."""
    if is_battery:
        return (
            " This is a battery-powered camera: live viewing streams from the cloud "
            "and drains the battery, so watch it only when needed (the stream runs "
            "only while someone is watching). The lower-bandwidth sub stream is "
            "preselected under Advanced."
        )
    return (
        " This is a mains-powered camera. If it is reachable over local RTSP, the "
        "official EZVIZ integration can stream it over your LAN (lower latency, no "
        "cloud limits) and is the better choice where available; use this integration "
        "for cameras without local RTSP, or when you specifically want the cloud path."
    )


def _camera_subentry_data(
    serial: str,
    user_input: dict[str, Any],
    *,
    is_battery: bool | None,
    is_encrypted: bool | None,
) -> dict[str, Any]:
    """Build the subentry data dict from a flattened options/reconfigure form."""
    data = {
        CONF_SERIAL: serial,
        CONF_VERIFICATION_CODE: user_input.get(CONF_VERIFICATION_CODE, ""),
        CONF_THUMBNAIL_MODE: user_input.get(CONF_THUMBNAIL_MODE, THUMBNAIL_INTERVAL),
        CONF_SNAPSHOT_INTERVAL: int(
            user_input.get(CONF_SNAPSHOT_INTERVAL, DEFAULT_SNAPSHOT_INTERVAL)
        ),
        CONF_STREAM: int(user_input[CONF_STREAM]),
        CONF_FORCE_H264: bool(user_input.get(CONF_FORCE_H264, DEFAULT_FORCE_H264)),
        CONF_RECORDINGS_MODE: user_input.get(
            CONF_RECORDINGS_MODE, DEFAULT_RECORDINGS_MODE
        ),
    }
    if is_battery is not None:  # omit when unknown rather than store a null
        data[CONF_IS_BATTERY] = is_battery
    if is_encrypted is not None:
        data[CONF_IS_ENCRYPTED] = is_encrypted
    if data[CONF_THUMBNAIL_MODE] == THUMBNAIL_STATIC_MOTION:
        # Re-anchor to now on every save, so a save dismisses any current alarm image
        # and only motion newer than this moment shows.
        data[CONF_STATIC_ANCHOR] = dt_util.utcnow().timestamp()
    return data


def _yes_no(value: bool | None) -> str:  # noqa: FBT001 - simple display formatter
    """Format a tri-state yes/no flag for display in the config flow."""
    if value is None:
        return "Unknown"
    return "Yes" if value else "No"


def _code_hint(is_encrypted: bool | None) -> str:  # noqa: FBT001 - display formatter
    """
    Verification-code sentence for the form description, matching the code field.

    The field is always shown; when the camera is unencrypted the code is optional but
    still useful, so the hint explains it lets older recordings (from a time when
    Image Encryption was on) be decrypted.
    """
    if is_encrypted is False:
        return (
            "This camera is not encrypted, so the code is optional. Enter its "
            "verification code (the 6-character code on the camera label) only if "
            "Image Encryption was ever enabled, so recordings from that period can "
            "still be played; leave blank otherwise. "
        )
    if is_encrypted:
        return (
            "This camera has Image Encryption on - enter its verification code "
            "(the 6-character code on the camera label). "
        )
    return (
        "If this camera has Image Encryption on - or ever did - enter its "
        "verification code (the 6-character code on the camera label), so its "
        "recordings can be decrypted; leave blank otherwise. "
    )


def _code_error(code: str, *, is_encrypted: bool | None, pwd_hash: str) -> str | None:
    """
    Validate a verification code before the (slow) frame grab.

    Returns an error key, or None if the code is acceptable: it is required when the
    device has Image Encryption on, and - when the device exposes its password hash
    (STATUS.encryptPwd) - it must match, so a wrong code is caught without a grab.
    """
    if is_encrypted and not code:
        return "code_required"
    if pwd_hash and code and password_hash(code) != pwd_hash:
        return "invalid_code"
    return None


def _stored_interval(data: Mapping[str, Any]) -> int:
    """Return the saved refresh interval, mapping the legacy boolean when needed."""
    if CONF_SNAPSHOT_INTERVAL in data:
        return int(data[CONF_SNAPSHOT_INTERVAL])
    if data.get(CONF_SLOW_THUMBNAILS):
        return DEFAULT_SNAPSHOT_INTERVAL_BATTERY
    return DEFAULT_SNAPSHOT_INTERVAL


_ACCOUNT_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_USERNAME): TextSelector(),
        vol.Required(CONF_PASSWORD): TextSelector(
            TextSelectorConfig(type=TextSelectorType.PASSWORD)
        ),
        vol.Required(CONF_REGION, default=DEFAULT_REGION): SelectSelector(
            SelectSelectorConfig(
                options=sorted(REGION_API_CODES),
                mode=SelectSelectorMode.DROPDOWN,
            )
        ),
    }
)


class EzvizStreamConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle the EZVIZ Stream account config flow."""

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Authenticate the EZVIZ account and create the account entry."""
        errors: dict[str, str] = {}
        if user_input is not None:
            api = EzvizCloudApi(async_get_clientsession(self.hass), self.hass)
            try:
                await api.async_login(
                    user_input[CONF_USERNAME],
                    user_input[CONF_PASSWORD],
                    user_input[CONF_REGION],
                )
            except InvalidAuth:
                errors["base"] = "invalid_auth"
            except MfaRequired:
                errors["base"] = "mfa_not_supported"
            except InvalidRegion:
                errors[CONF_REGION] = "invalid_region"
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except Exception:
                _LOGGER.exception("Unexpected error during EZVIZ login")
                errors["base"] = "unknown"
            else:
                await self.async_set_unique_id(user_input[CONF_USERNAME].lower())
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=user_input[CONF_USERNAME], data=user_input
                )

        return self.async_show_form(
            step_id="user", data_schema=_ACCOUNT_SCHEMA, errors=errors
        )

    async def async_step_reauth(
        self,
        entry_data: Mapping[str, Any],  # noqa: ARG002 - HA reauth signature
    ) -> ConfigFlowResult:
        """Start reauth when the stored credentials stop working."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Re-validate the account with a new password, keeping user/region."""
        reauth_entry = self._get_reauth_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            api = EzvizCloudApi(async_get_clientsession(self.hass), self.hass)
            try:
                await api.async_login(
                    reauth_entry.data[CONF_USERNAME],
                    user_input[CONF_PASSWORD],
                    reauth_entry.data[CONF_REGION],
                )
            except InvalidAuth:
                errors["base"] = "invalid_auth"
            except MfaRequired:
                errors["base"] = "mfa_not_supported"
            except CannotConnect:
                errors["base"] = "cannot_connect"
            except Exception:
                _LOGGER.exception("Unexpected error during EZVIZ reauth")
                errors["base"] = "unknown"
            else:
                return self.async_update_reload_and_abort(
                    reauth_entry,
                    data_updates={CONF_PASSWORD: user_input[CONF_PASSWORD]},
                )

        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PASSWORD): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    )
                }
            ),
            errors=errors,
            description_placeholders={CONF_USERNAME: reauth_entry.data[CONF_USERNAME]},
        )

    @classmethod
    @callback
    def async_get_supported_subentry_types(
        cls,
        config_entry: ConfigEntry,  # noqa: ARG003 - signature fixed by Home Assistant
    ) -> dict[str, type[ConfigSubentryFlow]]:
        """Return the subentry flows this integration supports."""
        return {CAMERA_SUBENTRY_TYPE: CameraSubentryFlowHandler}

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: ConfigEntry,  # noqa: ARG004 - HA provides the entry via property
    ) -> EzvizStreamOptionsFlow:
        """Return the account-level options flow (cloud tuning knobs)."""
        return EzvizStreamOptionsFlow()


class EzvizStreamOptionsFlow(OptionsFlow):
    """Account-level options: tune how the integration talks to the EZVIZ cloud."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show and store the account tuning options."""
        if user_input is not None:
            # NumberSelector yields a float; store an int for a clean semaphore size.
            return self.async_create_entry(
                data={
                    CONF_MAX_SNAPSHOTS: int(user_input[CONF_MAX_SNAPSHOTS]),
                    CONF_ENABLE_RECORDINGS: user_input[CONF_ENABLE_RECORDINGS],
                }
            )

        current = self.config_entry.options.get(
            CONF_MAX_SNAPSHOTS, DEFAULT_MAX_SNAPSHOTS
        )
        recordings = self.config_entry.options.get(
            CONF_ENABLE_RECORDINGS, DEFAULT_ENABLE_RECORDINGS
        )
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_MAX_SNAPSHOTS, default=current): NumberSelector(
                        NumberSelectorConfig(
                            min=1,
                            max=MAX_MAX_SNAPSHOTS,
                            step=1,
                            mode=NumberSelectorMode.BOX,
                        )
                    ),
                    vol.Required(
                        CONF_ENABLE_RECORDINGS, default=recordings
                    ): BooleanSelector(),
                }
            ),
        )


class CameraSubentryFlowHandler(ConfigSubentryFlow):
    """Add a camera (subentry) to an EZVIZ account entry."""

    def __init__(self) -> None:
        """Initialise the flow; picked camera + pending save carry between steps."""
        super().__init__()
        self._camera: EzvizCamera | None = None
        # Set when a frame check fails, so the verify-failed menu can save anyway.
        self._pending_data: dict[str, Any] | None = None
        self._pending_subentry: ConfigSubentry | None = None

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> SubentryFlowResult:
        """Pick a camera from the account, then configure it."""
        entry: EzvizStreamConfigEntry = self._get_entry()

        try:
            cameras = await self._async_account_cameras(entry)
        except CannotConnect:
            return self.async_abort(reason="cannot_connect")
        except InvalidAuth, MfaRequired:
            return self.async_abort(reason="invalid_auth")

        already_added = {
            subentry.data[CONF_SERIAL] for subentry in entry.subentries.values()
        }
        available = [cam for cam in cameras if cam.serial not in already_added]
        if not available:
            return self.async_abort(reason="no_cameras")

        if user_input is not None:
            self._camera = next(
                cam for cam in available if cam.serial == user_input[CONF_SERIAL]
            )
            return await self.async_step_options()

        schema = vol.Schema(
            {
                vol.Required(CONF_SERIAL): SelectSelector(
                    SelectSelectorConfig(
                        options=[
                            SelectOptionDict(value=cam.serial, label=cam.picker_label)
                            for cam in available
                        ],
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                ),
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    async def async_step_options(
        self, user_input: dict[str, Any] | None = None
    ) -> SubentryFlowResult:
        """Supply the verification code, thumbnail source, and stream for a new cam."""
        camera = self._camera
        assert camera is not None  # noqa: S101 - set by async_step_user before we get here
        errors: dict[str, str] = {}

        if user_input is not None:
            flat = _flatten_options(user_input)
            code = flat.get(CONF_VERIFICATION_CODE, "")
            error = _code_error(
                code,
                is_encrypted=camera.is_encrypted,
                pwd_hash=camera.encrypt_pwd_hash,
            )
            if error:
                errors[CONF_VERIFICATION_CODE] = error
            else:
                data = _camera_subentry_data(
                    camera.serial,
                    flat,
                    is_battery=camera.is_battery,
                    is_encrypted=camera.is_encrypted,
                )
                if await self._async_frame_ok(data):
                    return self.async_create_entry(
                        title=camera.label, unique_id=camera.serial, data=data
                    )
                self._pending_data, self._pending_subentry = data, None
                return await self.async_step_verify_failed()

        # Battery cams default to a static baseline that only shows newer motion,
        # refreshed from the no-wake alarm API (never woken just for a tile), a long
        # refresh interval, and the lower-bandwidth sub stream; all overridable.
        battery = camera.is_battery
        return self.async_show_form(
            step_id="options",
            data_schema=_camera_options_schema(
                verification_code="",
                is_encrypted=camera.is_encrypted,
                thumbnail_mode=(
                    THUMBNAIL_STATIC_MOTION if battery else THUMBNAIL_INTERVAL
                ),
                snapshot_interval=(
                    DEFAULT_SNAPSHOT_INTERVAL_BATTERY
                    if battery
                    else DEFAULT_SNAPSHOT_INTERVAL
                ),
                stream=SUB_STREAM if battery else DEFAULT_STREAM,
                force_h264=DEFAULT_FORCE_H264,
                recordings_mode=DEFAULT_RECORDINGS_MODE,
            ),
            errors=errors,
            description_placeholders={
                "camera": camera.label,
                "serial": camera.serial,
                "battery": _yes_no(camera.is_battery),
                "encrypted": _yes_no(camera.is_encrypted),
                "code_hint": _code_hint(camera.is_encrypted),
                "camera_note": _camera_note(is_battery=camera.is_battery),
            },
        )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> SubentryFlowResult:
        """Edit an already-added camera's verification code, thumbnail, and stream."""
        subentry = self._get_reconfigure_subentry()
        camera = await self._async_lookup_camera(subentry)
        is_battery = camera.is_battery if camera else subentry.data.get(CONF_IS_BATTERY)
        is_encrypted = (
            camera.is_encrypted if camera else subentry.data.get(CONF_IS_ENCRYPTED)
        )
        pwd_hash = camera.encrypt_pwd_hash if camera else ""
        errors: dict[str, str] = {}

        if user_input is not None:
            flat = _flatten_options(user_input)
            code = flat.get(CONF_VERIFICATION_CODE, "")
            error = _code_error(code, is_encrypted=is_encrypted, pwd_hash=pwd_hash)
            if error:
                errors[CONF_VERIFICATION_CODE] = error
            else:
                data = _camera_subentry_data(
                    subentry.data[CONF_SERIAL],
                    flat,
                    is_battery=is_battery,
                    is_encrypted=is_encrypted,
                )
                if await self._async_frame_ok(data):
                    return self.async_update_and_abort(
                        self._get_entry(), subentry, data=data
                    )
                self._pending_data, self._pending_subentry = data, subentry
                return await self.async_step_verify_failed()

        return self.async_show_form(
            step_id="reconfigure",
            data_schema=_camera_options_schema(
                verification_code=subentry.data.get(CONF_VERIFICATION_CODE, ""),
                is_encrypted=is_encrypted,
                thumbnail_mode=subentry.data.get(CONF_THUMBNAIL_MODE)
                or (
                    THUMBNAIL_MOTION
                    if subentry.data.get(CONF_MOTION_THUMBNAIL)
                    else THUMBNAIL_INTERVAL
                ),
                snapshot_interval=_stored_interval(subentry.data),
                stream=subentry.data.get(CONF_STREAM, DEFAULT_STREAM),
                force_h264=subentry.data.get(CONF_FORCE_H264, DEFAULT_FORCE_H264),
                recordings_mode=subentry.data.get(
                    CONF_RECORDINGS_MODE, DEFAULT_RECORDINGS_MODE
                ),
            ),
            errors=errors,
            description_placeholders={
                "camera": subentry.title,
                "serial": subentry.data[CONF_SERIAL],
                "battery": _yes_no(is_battery),
                "encrypted": _yes_no(is_encrypted),
                "code_hint": _code_hint(is_encrypted),
            },
        )

    async def _async_lookup_camera(
        self, subentry: ConfigSubentry
    ) -> EzvizCamera | None:
        """Find this subentry's camera on the account (None if unreachable)."""
        try:
            cameras = await self._async_account_cameras(self._get_entry())
        except CannotConnect, InvalidAuth, MfaRequired:
            return None
        return next(
            (c for c in cameras if c.serial == subentry.data[CONF_SERIAL]), None
        )

    async def async_step_verify_failed(
        self,
        user_input: dict[str, Any] | None = None,  # noqa: ARG002 - menu step signature
    ) -> SubentryFlowResult:
        """Offer retry or save-anyway after a failed frame check."""
        return self.async_show_menu(
            step_id="verify_failed", menu_options=["retry", "save_anyway"]
        )

    async def async_step_retry(
        self,
        user_input: dict[str, Any] | None = None,  # noqa: ARG002 - menu choice signature
    ) -> SubentryFlowResult:
        """Re-show the options/reconfigure form so the check runs again on submit."""
        if self._pending_subentry is not None:
            return await self.async_step_reconfigure()
        return await self.async_step_options()

    async def async_step_save_anyway(
        self,
        user_input: dict[str, Any] | None = None,  # noqa: ARG002 - menu choice signature
    ) -> SubentryFlowResult:
        """Save the camera despite the failed frame check."""
        assert self._pending_data is not None  # noqa: S101 - set before the menu
        if self._pending_subentry is not None:
            return self.async_update_and_abort(
                self._get_entry(), self._pending_subentry, data=self._pending_data
            )
        assert self._camera is not None  # noqa: S101 - add path always has a camera
        return self.async_create_entry(
            title=self._camera.label,
            unique_id=self._camera.serial,
            data=self._pending_data,
        )

    async def _async_frame_ok(self, data: dict[str, Any]) -> bool:
        """
        Grab one frame to confirm the verification code + stream (soft check).

        Returns True on a decoded frame. A False result is ambiguous (wrong code, or
        a sleeping cam / transient cloud error), so callers treat it as a soft block.
        """
        entry: EzvizStreamConfigEntry = self._get_entry()
        try:
            api = await self._async_api(entry)
            camera = next(
                (
                    cam
                    for cam in await api.async_get_cameras()
                    if cam.serial == data[CONF_SERIAL]
                ),
                None,
            )
            if camera is None:
                return False
            jpeg = await grab_jpeg(
                camera,
                api.async_get_vtdu_token,
                get_ffmpeg_manager(self.hass).binary,
                stream=data[CONF_STREAM],
                verification_code=data[CONF_VERIFICATION_CODE],
                duration=_VERIFY_TIMEOUT,
                max_sessions=_VERIFY_MAX_SESSIONS,
            )
        except CannotConnect, InvalidAuth, MfaRequired:
            return False
        if jpeg is None:
            return False
        # Seed the camera's snapshot with this confirmed frame so its tile shows at
        # once after the reload, instead of blocking the first image request on a slow
        # live grab (which HA's image timeout would abort, blanking the tile).
        await self.hass.async_add_executor_job(
            persist_snapshot, self.hass, data[CONF_SERIAL], jpeg
        )
        return True

    async def _async_api(self, entry: EzvizStreamConfigEntry) -> EzvizCloudApi:
        """Return the account's API client, reusing a loaded session if any."""
        if entry.state is ConfigEntryState.LOADED and entry.runtime_data:
            return entry.runtime_data.api
        api = EzvizCloudApi(async_get_clientsession(self.hass), self.hass)
        await api.async_login(
            entry.data[CONF_USERNAME],
            entry.data[CONF_PASSWORD],
            entry.data[CONF_REGION],
        )
        return api

    async def _async_account_cameras(
        self, entry: EzvizStreamConfigEntry
    ) -> list[EzvizCamera]:
        """Return the account's streamable cameras, reusing a live session if any."""
        api = await self._async_api(entry)
        return await api.async_get_cameras()

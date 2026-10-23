"""为独立暮色大屏提供已登录用户共享的背景图库与规则。"""
from __future__ import annotations

import asyncio
from copy import deepcopy
import json
import logging
from pathlib import Path
import time
import uuid

from aiohttp import web
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.http import HomeAssistantView
from homeassistant.helpers.storage import Store

from .model import BackgroundInputError, IMAGE_FOLDER, ID_PATTERN, MAX_IMAGES, initial_state, prepare_image, validate_image_patch, validate_settings

DOMAIN = "home_evening_backgrounds"
CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)
LOGGER = logging.getLogger(__name__)


async def async_setup(hass, config):
    """加载独立存储并注册认证接口，不变更其他仪表盘或设备。"""
    manager = BackgroundManager(hass)
    await manager.async_load()
    hass.data[DOMAIN] = manager
    hass.http.register_view(BackgroundView(manager))
    hass.http.register_view(BackgroundImageView(manager))
    return True


class BackgroundManager:
    """串行保存共享配置，阻止不同设备覆盖彼此的旧版本。"""

    def __init__(self, hass):
        """绑定 HA 存储及独立图片目录。"""
        self.hass = hass
        self.store = Store(hass, 1, DOMAIN)
        self.folder = Path(hass.config.path(IMAGE_FOLDER))
        self.state = initial_state()
        self.lock = asyncio.Lock()

    async def async_load(self):
        """恢复图库，首次使用时保留内置背景默认规则。"""
        saved = await self.store.async_load()
        if saved is not None:
            self.state = saved
        await self.hass.async_add_executor_job(self.folder.mkdir, 0o755, True, True)

    def snapshot(self):
        """返回独立副本，避免调用方直接修改运行中的配置。"""
        return deepcopy(self.state)

    def write_images(self, image_id, original, thumb):
        """只向专属目录原子写入由 UUID 命名的图片。"""
        for suffix, content in [(".webp", original), ("-thumb.webp", thumb)]:
            target = self.folder / (image_id + suffix)
            temporary = target.with_suffix(target.suffix + ".tmp")
            temporary.write_bytes(content)
            temporary.replace(target)

    def remove_images(self, image_id):
        """删除精确匹配的受管理图片，不遍历或递归清理目录。"""
        if not ID_PATTERN.fullmatch(image_id):
            raise BackgroundInputError("unknown_image")
        for suffix in [".webp", "-thumb.webp", ".webp.tmp", "-thumb.webp.tmp"]:
            (self.folder / (image_id + suffix)).unlink(missing_ok=True)

    async def change(self, payload):
        """处理经过认证的修改，保存成功后才发布新版本。"""
        if not isinstance(payload, dict):
            raise BackgroundInputError("invalid_request")
        async with self.lock:
            if type(payload.get("revision")) is not int or payload["revision"] != self.state["revision"]:
                raise BackgroundInputError("revision_conflict")
            next_state = self.snapshot()
            action = payload.get("action")
            if not isinstance(action, str):
                raise BackgroundInputError("invalid_action")
            uploaded = None
            removed = None
            if action == "settings":
                patch = validate_settings(payload.get("patch"), next_state["images"])
                next_state["settings"].update(patch)
                if set(patch) - {"fit"}:
                    next_state["anchor_ms"] = int(time.time() * 1000)
            elif action == "upload":
                if len(next_state["images"]) >= MAX_IMAGES:
                    raise BackgroundInputError("gallery_full")
                theme = payload.get("theme", "all")
                if not isinstance(theme, str) or theme not in {"all", "light", "dark"}:
                    raise BackgroundInputError("invalid_theme")
                metadata, original, thumb = await self.hass.async_add_executor_job(prepare_image, payload.get("data"), payload.get("filename"))
                uploaded = uuid.uuid4().hex
                metadata.update({"id": uploaded, "theme": theme, "enabled": True})
                try:
                    await self.hass.async_add_executor_job(self.write_images, uploaded, original, thumb)
                except Exception:
                    LOGGER.exception("Background image write failed")
                    await self.hass.async_add_executor_job(self.remove_images, uploaded)
                    raise
                next_state["images"].append(metadata)
            elif action in {"image", "move", "delete"}:
                image_id = payload.get("id")
                index = next((i for i, image in enumerate(next_state["images"]) if image["id"] == image_id), None)
                if index is None:
                    raise BackgroundInputError("unknown_image")
                if action == "image":
                    next_state["images"][index].update(validate_image_patch(payload.get("patch")))
                elif action == "move":
                    direction = payload.get("direction")
                    if type(direction) is not int or direction not in {-1, 1}:
                        raise BackgroundInputError("invalid_direction")
                    other = index + direction
                    if not 0 <= other < len(next_state["images"]):
                        raise BackgroundInputError("invalid_direction")
                    next_state["images"][index], next_state["images"][other] = next_state["images"][other], next_state["images"][index]
                else:
                    removed = image_id
                    next_state["images"].pop(index)
                    if next_state["settings"]["selected_id"] == image_id:
                        next_state["settings"]["selected_id"] = ""
                        next_state["anchor_ms"] = int(time.time() * 1000)
            else:
                raise BackgroundInputError("invalid_action")
            next_state["revision"] += 1
            try:
                await self.store.async_save(next_state)
            except Exception:
                LOGGER.exception("Shared background configuration save failed")
                if uploaded:
                    await self.hass.async_add_executor_job(self.remove_images, uploaded)
                raise
            self.state = next_state
            if removed:
                try:
                    await self.hass.async_add_executor_job(self.remove_images, removed)
                except OSError:
                    LOGGER.exception("Background file cleanup failed after configuration save")
            return self.snapshot()


class BackgroundView(HomeAssistantView):
    """允许所有已登录 HA 用户读取和管理共享背景。"""

    url = "/api/home_evening/backgrounds"
    name = "api:home_evening:backgrounds"
    requires_auth = True

    def __init__(self, manager):
        """保存已初始化的共享背景管理器。"""
        self.manager = manager

    async def get(self, request):
        """返回图库与循环规则，禁止缓存旧配置。"""
        return web.json_response(self.manager.snapshot(), headers={"Cache-Control": "no-store"})

    async def post(self, request):
        """限制上传体积并将校验失败转换为明确错误码。"""
        request._client_max_size = 15 * 1024 * 1024
        try:
            payload = await request.json()
            state = await self.manager.change(payload)
            return web.json_response(state, headers={"Cache-Control": "no-store"})
        except (json.JSONDecodeError, UnicodeDecodeError):
            LOGGER.warning("Invalid shared background JSON request")
            return web.json_response({"error": "invalid_request"}, status=400)
        except BackgroundInputError as error:
            LOGGER.warning("Shared background request rejected: %s", error)
            return web.json_response({"error": str(error)}, status=409 if str(error) == "revision_conflict" else 400)
        except web.HTTPRequestEntityTooLarge:
            LOGGER.warning("Shared background request exceeded the size limit")
            return web.json_response({"error": "image_too_large"}, status=413)
        except Exception:
            LOGGER.exception("Shared background request failed")
            return web.json_response({"error": "storage_failed"}, status=500)


class BackgroundImageView(HomeAssistantView):
    """通过 HA 当前登录会话读取图片，不将上传图库放入公开静态目录。"""

    url = "/api/home_evening/backgrounds/image/{image_id}/{kind}"
    name = "api:home_evening:background-image"
    requires_auth = True

    def __init__(self, manager):
        """复用图库管理器及受保护的图片目录。"""
        self.manager = manager

    async def get(self, request, image_id, kind):
        """仅返回图库中存在的 UUID 文件或缩略图。"""
        if not ID_PATTERN.fullmatch(image_id) or kind not in {"original", "thumbnail"} or not any(image["id"] == image_id for image in self.manager.state["images"]):
            return web.json_response({"error": "unknown_image"}, status=404)
        path = self.manager.folder / (image_id + ("-thumb.webp" if kind == "thumbnail" else ".webp"))
        return web.FileResponse(path, headers={"Content-Type": "image/webp", "Cache-Control": "private, max-age=86400, immutable", "X-Content-Type-Options": "nosniff"})

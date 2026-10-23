"""共享背景的数据校验与图片处理，不依赖 HA 运行环境。"""
from __future__ import annotations

import base64
from copy import deepcopy
from io import BytesIO
import re
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

DEFAULT_SETTINGS = {"source": "builtin", "cycle": True, "mode": "sequential", "interval_seconds": 3600, "fit": "cover", "selected_id": ""}
MAX_IMAGES = 30
MAX_UPLOAD = 10 * 1024 * 1024
IMAGE_FOLDER = "home-evening-backgrounds"
ID_PATTERN = re.compile(r"[0-9a-f]{32}")
BUILTIN_PATTERN = re.compile(r"builtin-(?:light|dark)-[012]")


class BackgroundInputError(ValueError):
    """用稳定的英文错误码描述输入问题，供前端转换为操作提示。"""


def initial_state():
    """返回与原有每小时背景轮换兼容的共享默认值。"""
    return {"revision": 0, "anchor_ms": 0, "settings": deepcopy(DEFAULT_SETTINGS), "images": []}


def validate_settings(patch, images):
    """只接收已知的背景选项及受管理的图片 ID。"""
    if not isinstance(patch, dict) or not patch or set(patch) - set(DEFAULT_SETTINGS):
        raise BackgroundInputError("invalid_settings")
    result = deepcopy(patch)
    enums = {"source": {"builtin", "custom", "all"}, "mode": {"sequential", "random"}, "fit": {"cover", "contain", "stretch"}}
    for key, allowed in enums.items():
        if key in result and (not isinstance(result[key], str) or result[key] not in allowed):
            raise BackgroundInputError("invalid_settings")
    if "cycle" in result and type(result["cycle"]) is not bool:
        raise BackgroundInputError("invalid_settings")
    if "interval_seconds" in result and (type(result["interval_seconds"]) is not int or not 5 <= result["interval_seconds"] <= 86400):
        raise BackgroundInputError("invalid_interval")
    if "selected_id" in result:
        selected = result["selected_id"]
        known = {image["id"] for image in images}
        if not isinstance(selected, str) or selected and not (BUILTIN_PATTERN.fullmatch(selected) or selected in known):
            raise BackgroundInputError("unknown_image")
    return result


def validate_image_patch(patch):
    """限制单张图片可修改的属性，不接收文件路径或任意 URL。"""
    if not isinstance(patch, dict) or not patch or set(patch) - {"theme", "enabled"}:
        raise BackgroundInputError("invalid_image_settings")
    if "theme" in patch and (not isinstance(patch["theme"], str) or patch["theme"] not in {"all", "light", "dark"}):
        raise BackgroundInputError("invalid_theme")
    if "enabled" in patch and type(patch["enabled"]) is not bool:
        raise BackgroundInputError("invalid_image_settings")
    return deepcopy(patch)


def prepare_image(encoded, filename):
    """验证图片并纠正方向，生成保留比例的背景与缩略图，清除原始元数据。"""
    if not isinstance(encoded, str) or len(encoded) > (MAX_UPLOAD * 4 // 3 + 8):
        raise BackgroundInputError("image_too_large")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise BackgroundInputError("invalid_image") from error
    if not content or len(content) > MAX_UPLOAD:
        raise BackgroundInputError("image_too_large")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"} or getattr(source, "n_frames", 1) != 1:
                    raise BackgroundInputError("unsupported_image")
                if source.width * source.height > 40000000:
                    raise BackgroundInputError("image_dimensions_too_large")
                original_size = source.size
                image = ImageOps.exif_transpose(source).convert("RGBA" if "A" in source.getbands() or "transparency" in source.info else "RGB")
                image.thumbnail((4096, 4096), Image.Resampling.LANCZOS)
                result = BytesIO()
                image.save(result, "WEBP", quality=90, method=4)
                width, height = image.size
                image.thumbnail((320, 192), Image.Resampling.LANCZOS)
                thumb = BytesIO()
                image.save(thumb, "WEBP", quality=82, method=4)
                image.close()
    except BackgroundInputError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise BackgroundInputError("invalid_image") from error
    # 名称只作为界面文本保存；文件名始终由服务端生成的 UUID 决定。
    name = str(filename or "背景图片").replace("\\", "/").split("/")[-1]
    name = "".join(char for char in name if ord(char) >= 32)[:120] or "背景图片"
    return {"name": name, "width": width, "height": height, "original_width": original_size[0], "original_height": original_size[1], "size": len(result.getvalue())}, result.getvalue(), thumb.getvalue()

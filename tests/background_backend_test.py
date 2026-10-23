"""校验共享背景的输入边界与真实图片处理，不需要连接 HA。"""
import base64
from io import BytesIO
import importlib.util
from pathlib import Path
import unittest

from PIL import Image

SPEC = importlib.util.spec_from_file_location("background_model", Path(__file__).resolve().parents[1] / "integrations/custom_components/home_evening_backgrounds/model.py")
MODEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODEL)


class BackgroundModelTests(unittest.TestCase):
    """覆盖权限接口接收数据后的关键校验规则。"""

    def test_settings_reject_invalid_types_and_unmanaged_ids(self):
        """拒绝越界间隔、伪造 ID、任意路径与错误类型。"""
        for patch in [{"interval_seconds": 4}, {"interval_seconds": True}, {"source": []}, {"fit": "url(x)"}, {"cycle": 1}, {"selected_id": "../../configuration.yaml"}, {"unknown": True}]:
            with self.subTest(patch=patch), self.assertRaises(MODEL.BackgroundInputError):
                MODEL.validate_settings(patch, [])
        self.assertEqual(MODEL.validate_settings({"interval_seconds": 5, "fit": "contain", "selected_id": "builtin-light-1"}, []), {"interval_seconds": 5, "fit": "contain", "selected_id": "builtin-light-1"})

    def test_theme_and_enabled_validation(self):
        """图片编辑只允许适用主题及循环开关。"""
        self.assertEqual(MODEL.validate_image_patch({"theme": "dark", "enabled": False}), {"theme": "dark", "enabled": False})
        for patch in [{"theme": []}, {"enabled": "false"}, {"url": "/config/secrets.yaml"}]:
            with self.subTest(patch=patch), self.assertRaises(MODEL.BackgroundInputError):
                MODEL.validate_image_patch(patch)

    def test_portrait_image_keeps_aspect_ratio_and_normalizes_name(self):
        """竖图保留尺寸与比例，缩略图不裁切主体，文件名只作文本。"""
        output = BytesIO()
        Image.new("RGB", (300, 600), "navy").save(output, "PNG")
        metadata, original, thumb = MODEL.prepare_image(base64.b64encode(output.getvalue()).decode(), "../../portrait.png")
        self.assertEqual((metadata["width"], metadata["height"]), (300, 600))
        self.assertEqual(metadata["name"], "portrait.png")
        with Image.open(BytesIO(original)) as image:
            self.assertEqual(image.format, "WEBP")
        with Image.open(BytesIO(thumb)) as image:
            self.assertEqual(image.size, (96, 192))

    def test_invalid_and_oversized_data_is_rejected(self):
        """损坏图片及超出上限的请求不会写入文件。"""
        for content in ["!invalid-base64!", base64.b64encode(b"<svg></svg>").decode(), "A" * (MODEL.MAX_UPLOAD * 4 // 3 + 12)]:
            with self.assertRaises(MODEL.BackgroundInputError):
                MODEL.prepare_image(content, "image.png")


if __name__ == "__main__":
    unittest.main()

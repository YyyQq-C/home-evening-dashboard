"""只读检查项目文件结构、源文件语法、默认配置和已知敏感模式。"""
import ast
import json
import logging
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def validate():
    """检查公开包，不导入 HA 集成、不建立网络连接、不改写配置。"""
    if sys.version_info < (3, 14):
        raise RuntimeError("Python 3.14 is required to validate the bundled EZVIZ backend syntax")
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required for JavaScript syntax validation")
    checks = {"files": 0, "javascript": 0, "python": 0, "json": 0}
    private_patterns = [
        re.compile(r"ha\.home\.(?:woyoai|yesmiller)\.com", re.I),
        re.compile("BA" + "760" + "2000", re.I),
        re.compile("融城" + "启元|4-1-" + "1401|张" + "老师"),
        re.compile(r"192\.168\.\d+\.\d+"),
        re.compile(r"C:[/\\]+Users[/\\]+ADMIN", re.I),
        re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----\s*\n[A-Za-z0-9+/=]{32,}"),
        re.compile(r"(?:sensor|binary_sensor|switch|number)\.example_[a-z0-9_]*\d{9,}"),
    ]
    failures = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT).as_posix()
        if any(part in {"node_modules", "__pycache__", ".git"} for part in path.relative_to(ROOT).parts):
            continue
        checks["files"] += 1
        if path.name in {"credentials.json", ".env", "config.db", "status.db"} or path.suffix in {".key", ".pem", ".dwg", ".db", ".log", ".jsonl"}:
            failures.append(relative + ": forbidden artifact")
        if path.suffix in {".js", ".mjs", ".py", ".json", ".yaml", ".md", ".html", ".txt"}:
            text = path.read_text(encoding="utf-8-sig")
            if any(pattern.search(text) for pattern in private_patterns):
                failures.append(relative + ": known private pattern")
            if path.suffix in {".js", ".mjs"}:
                result = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
                if result.returncode:
                    failures.append(relative + ": JavaScript syntax invalid")
                checks["javascript"] += 1
            elif path.suffix == ".py":
                ast.parse(text, filename=relative)
                checks["python"] += 1
            elif path.suffix == ".json":
                json.loads(text)
                checks["json"] += 1
    site = ROOT / "www/home-evening"
    for name in ["index.html", "control.html", "control-page.js", "control-actions.js", "site-config.js", "model-host.html", "model.js", "assets/floorplan-textured.webp"]:
        if not (site / name).is_file():
            failures.append(name + ": required file missing")
    config_path = site / "site-config.js"
    script = "import {SITE} from " + json.dumps(config_path.as_uri()) + "; console.log(JSON.stringify(SITE));"
    result = subprocess.run([node, "--input-type=module", "-e", script], check=True, capture_output=True, text=True)
    config = json.loads(result.stdout)
    keys = [device.get("key") for device in config["control"]["devices"]]
    if len(keys) != len(set(keys)):
        failures.append("site-config.js: duplicate device key")
    if config["control"]["mode"] not in {"read-only", "live"}:
        failures.append("site-config.js: invalid control mode")
    if failures:
        for failure in failures:
            logging.error("Package validation failed: %s", failure)
        raise RuntimeError("Reader package validation failed")
    print("READER_PACKAGE_VALIDATED", json.dumps(checks, sort_keys=True))


if __name__ == "__main__":
    try:
        validate()
    except Exception:
        logging.exception("Reader package validation failed")
        raise

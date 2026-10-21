"""为首次安装生成和风预算初始化文件，不连接或修改 Home Assistant。"""
import argparse
from datetime import datetime
import json
import logging
from pathlib import Path


def create_quota(month, used, output):
    """校验用户输入的月份和已用次数，以独占方式生成新文件。"""
    parsed = datetime.strptime(month, "%Y-%m")
    if parsed.strftime("%Y-%m") != month or not isinstance(used, int) or used < 0:
        raise ValueError("Invalid quota month or usage")
    data = {"version": 1, "minor_version": 1, "key": "heweather_monthly_quota", "data": {"month": month, "count": used, "cache": {}}}
    # 不覆盖已存在文件，防止意外清空既有预算及缓存。
    with Path(output).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(data, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def main():
    """读取显式参数，仅在本机生成初始化文件。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", required=True)
    parser.add_argument("--used", type=int, required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        create_quota(args.month, args.used, args.output)
        print("WEATHER_QUOTA_FILE_CREATED")
    except Exception:
        logging.exception("Weather quota file generation failed")
        raise


if __name__ == "__main__":
    main()

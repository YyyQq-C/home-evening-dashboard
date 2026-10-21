"""持久化和风天气月请求预算，达到限额时返回最近成功数据。"""
import asyncio
from contextlib import asynccontextmanager
import hashlib
import json
import logging
import re

from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

MONTHLY_LIMIT = 45000
STORAGE_KEY = "heweather_monthly_quota"
_LOGGER = logging.getLogger(__name__)


class MonthlyQuotaUnavailable(Exception):
    """预算不可用且无缓存时阻止请求，避免计数失效后继续调用。"""


class CachedResponse:
    """提供集成现有调用所需的状态码和 JSON 结果。"""

    def __init__(self, status, data):
        """保存已读取的响应内容，释放底层 HTTP 连接。"""
        self.status = status
        self._data = data

    async def json(self):
        """返回天气数据，与 aiohttp 的异步 JSON 接口一致。"""
        return self._data


class MonthlyQuota:
    """为当前 HA 实例内所有和风接口共享一个持久化预算。"""

    def __init__(self, hass):
        """建立串行锁，防止多实体同时请求超过最后一个名额。"""
        self._hass = hass
        self._store = Store(hass, 1, STORAGE_KEY, atomic_writes=True, private=True)
        self._lock = asyncio.Lock()
        self._data = None
        self._blocked_month = None
        self._storage_failed = False

    def _read_saved_data(self):
        """重新读取磁盘内容，确认 HA Store 没有吞掉写入异常。"""
        with open(self._store.path, encoding="utf-8") as stream:
            return json.load(stream)["data"]

    async def _save(self):
        """原子保存后核对实际磁盘内容，写入失败时阻止请求。"""
        await self._store.async_save(self._data)
        saved = await self._hass.async_add_executor_job(self._read_saved_data)
        if saved != self._data:
            raise MonthlyQuotaUnavailable("Monthly quota disk verification failed")

    async def request(self, session, url, **kwargs):
        """先持久化占用名额，再发送单次请求；限额后复用成功缓存。"""
        key = hashlib.sha256(url.encode()).hexdigest()
        async with self._lock:
            try:
                if self._storage_failed:
                    raise MonthlyQuotaUnavailable("Monthly quota storage is unavailable")
                if self._data is None:
                    data = await self._store.async_load()
                    if not isinstance(data, dict) or not re.fullmatch(r"\d{4}-\d{2}", str(data.get("month", ""))) or type(data.get("count")) is not int or data["count"] < 0 or not isinstance(data.get("cache"), dict):
                        raise MonthlyQuotaUnavailable("Monthly quota must be initialized with current usage")
                    self._data = data
                month = dt_util.now().strftime("%Y-%m")
                if self._data["month"] > month:
                    raise MonthlyQuotaUnavailable("Monthly quota clock moved backwards")
                if self._data["month"] != month:
                    self._data = {"month": month, "count": 0, "cache": self._data["cache"]}
                if self._data["count"] >= MONTHLY_LIMIT:
                    if self._blocked_month != month:
                        _LOGGER.warning("QWeather monthly request limit reached: %s/%s; using cached data", self._data["count"], MONTHLY_LIMIT)
                        self._blocked_month = month
                    cached = self._data["cache"].get(key)
                    if cached is not None:
                        return CachedResponse(200, cached)
                    raise MonthlyQuotaUnavailable("Monthly request limit reached and no cached response exists")
                self._data["count"] += 1
                # 保存失败时不发送请求，重启也无法绕过已成功保存的计数。
                await self._save()
            except MonthlyQuotaUnavailable:
                _LOGGER.warning("QWeather request blocked by monthly budget")
                # 校验写入失败后继续阻止发送，不能使用仅存在于内存的额度。
                if self._data is not None and self._data["count"] < MONTHLY_LIMIT:
                    self._storage_failed = True
                raise
            except Exception as error:
                self._storage_failed = True
                _LOGGER.exception("QWeather monthly quota persistence failed")
                raise MonthlyQuotaUnavailable("Monthly quota persistence failed") from error

        # 禁止自动重定向，确保一个名额最多对应一次网络请求。
        kwargs["allow_redirects"] = False
        async with session.get(url, **kwargs) as response:
            status = response.status
            data = await response.json()
        if status == 200 and isinstance(data, dict) and str(data.get("code", "200")) == "200":
            async with self._lock:
                self._data["cache"][key] = data
                try:
                    await self._save()
                except Exception:
                    # 计数已在请求前落盘；缓存失败时禁止后续请求并记录异常。
                    self._storage_failed = True
                    _LOGGER.exception("QWeather response cache persistence failed")
        return CachedResponse(status, data)


def get_quota(hass):
    """返回 HA 全局共享实例，卸载或重载单个集成不会清零计数。"""
    if STORAGE_KEY not in hass.data:
        hass.data[STORAGE_KEY] = MonthlyQuota(hass)
    return hass.data[STORAGE_KEY]


async def budgeted_request(hass, session, url, **kwargs):
    """以现有 await 调用方式执行受预算约束的请求。"""
    return await get_quota(hass).request(session, url, **kwargs)


@asynccontextmanager
async def budgeted_get(hass, session, url, **kwargs):
    """兼容原有 async with 请求形式，共享预算及缓存。"""
    yield await budgeted_request(hass, session, url, **kwargs)

"""控客本地 SSH 隧道集成入口。"""
import logging
from datetime import timedelta
from homeassistant.config_entries import SOURCE_IMPORT
import voluptuous as vol
from homeassistant.const import Platform
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
from homeassistant.exceptions import HomeAssistantError
from .client import KonkeClient

DOMAIN = 'konke_local'
PLATFORMS = [Platform.CLIMATE, Platform.FAN]
LOGGER = logging.getLogger(__name__)
CONFIG_SCHEMA = vol.Schema({vol.Optional(DOMAIN): vol.Schema({
    vol.Required('host'): str,
    vol.Optional('port', default=22): vol.All(int, vol.Range(min=1, max=65535)),
    vol.Optional('username', default='root'): str,
    vol.Required('password'): str,
    vol.Required('host_key'): str,
})}, extra=vol.ALLOW_EXTRA)


async def async_setup(hass, config):
    """从管理员配置文件导入连接参数，沿用 HA 标准配置项流程。"""
    if DOMAIN in config:
        hass.async_create_task(hass.config_entries.flow.async_init(
            DOMAIN, context={'source': SOURCE_IMPORT}, data=dict(config[DOMAIN])))
    return True


class KonkeCoordinator(DataUpdateCoordinator):
    """在后台线程执行阻塞 SSH 操作，统一刷新所有设备。"""

    def __init__(self, hass, entry):
        """为配置项建立独立连接及固定轮询周期。"""
        super().__init__(hass, LOGGER, name=DOMAIN, config_entry=entry, update_interval=timedelta(seconds=30))
        self.client = KonkeClient(entry.data)

    async def _async_update_data(self):
        """将 SSH 或数据库异常转换为 HA 不可用状态。"""
        try:
            return await self.hass.async_add_executor_job(self.client.snapshot)
        except Exception as error:
            raise UpdateFailed('Unable to refresh Konke devices') from error

    async def control(self, key, changes):
        """执行单设备控制并读取真实状态，不预测控制结果。"""
        try:
            await self.hass.async_add_executor_job(self.client.control, key, changes)
        except Exception as error:
            LOGGER.exception('Konke entity command failed: device=%s', key)
            raise HomeAssistantError('Konke device command failed') from error
        await self.async_request_refresh()


async def async_setup_entry(hass, entry):
    """读取实际设备后加载空调、地暖及新风平台。"""
    coordinator = KonkeCoordinator(hass, entry)
    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception:
        await hass.async_add_executor_job(coordinator.client.close)
        raise
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass, entry):
    """卸载实体并关闭组件创建的 SSH 隧道。"""
    if await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        coordinator = hass.data[DOMAIN].pop(entry.entry_id)
        await hass.async_add_executor_job(coordinator.client.close)
        return True
    return False

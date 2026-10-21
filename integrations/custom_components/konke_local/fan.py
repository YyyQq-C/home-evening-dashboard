"""将新风设备映射为三档风扇。"""
import math
from homeassistant.components.fan import FanEntity, FanEntityFeature
from . import DOMAIN
from .entity import KonkeEntity


async def async_setup_entry(hass, entry, async_add_entities):
    """为实际已配置的新风子设备创建实体。"""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(KonkeFan(coordinator, entry, key) for key, device in coordinator.data.items() if device['kind'] == 'fresh')


class KonkeFan(KonkeEntity, FanEntity):
    """提供新风开关及三档风速，不推测原厂模式枚举。"""
    _attr_supported_features = FanEntityFeature.SET_SPEED | FanEntityFeature.TURN_ON | FanEntityFeature.TURN_OFF
    _attr_speed_count = 3
    _attr_icon = 'mdi:air-filter'

    @property
    def is_on(self):
        """读取新风实际开关状态。"""
        return self.state_data.get('on', False)

    @property
    def percentage(self):
        """将设备风速映射为 HA 百分比，关闭时返回零。"""
        return round(self.state_data.get('speed', 0) * 100 / 3) if self.is_on else 0

    async def async_set_percentage(self, percentage):
        """调整三档风速，零速对应关闭。"""
        if percentage == 0:
            await self.async_turn_off()
            return
        speed = max(1, min(3, math.ceil(percentage * 3 / 100)))
        await self.coordinator.control(self.key, {'speed': speed})
        if not self.is_on:
            await self.coordinator.control(self.key, {'on': True})

    async def async_turn_on(self, percentage=None, preset_mode=None, **kwargs):
        """开启新风，指定风速时先下发风速再开启。"""
        if percentage:
            await self.async_set_percentage(percentage)
        else:
            await self.coordinator.control(self.key, {'on': True})

    async def async_turn_off(self, **kwargs):
        """关闭新风设备。"""
        await self.coordinator.control(self.key, {'on': False})

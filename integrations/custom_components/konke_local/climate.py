"""空调和地暖的 HA 原生温控实体。"""
from homeassistant.components.climate import ClimateEntity, ClimateEntityFeature, HVACMode
from homeassistant.const import ATTR_TEMPERATURE, UnitOfTemperature
from . import DOMAIN
from .client import AC_MODES, AC_FANS
from .entity import KonkeEntity


async def async_setup_entry(hass, entry, async_add_entities):
    """只为已发现的空调和地暖通道创建温控实体。"""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(KonkeClimate(coordinator, entry, key) for key, device in coordinator.data.items() if device['kind'] in ('ac', 'floor'))


class KonkeClimate(KonkeEntity, ClimateEntity):
    """将原厂温控字段映射为模式、目标温度及空调风速。"""
    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_native_temperature_unit = UnitOfTemperature.CELSIUS

    def __init__(self, coordinator, entry, key):
        """按设备类型设置功能和温度步长。"""
        super().__init__(coordinator, entry, key)
        self.is_ac = self.device['kind'] == 'ac'
        self._attr_supported_features = ClimateEntityFeature.TARGET_TEMPERATURE | ClimateEntityFeature.TURN_ON | ClimateEntityFeature.TURN_OFF
        if self.is_ac:
            self._attr_supported_features |= ClimateEntityFeature.FAN_MODE
        self._attr_hvac_modes = [HVACMode.OFF, HVACMode.COOL, HVACMode.HEAT, HVACMode.DRY, HVACMode.FAN_ONLY, HVACMode.AUTO] if self.is_ac else [HVACMode.OFF, HVACMode.HEAT]
        self._attr_fan_modes = list(AC_FANS) if self.is_ac else None
        self._attr_min_temp = 16 if self.is_ac else 5
        self._attr_max_temp = 32 if self.is_ac else 45
        self._attr_target_temperature_step = 1 if self.is_ac else 0.5
        self._attr_icon = 'mdi:air-conditioner' if self.is_ac else 'mdi:heating-coil'

    @property
    def hvac_mode(self):
        """关闭时返回 OFF，运行时使用设备上报的工作模式。"""
        if not self.state_data.get('on'):
            return HVACMode.OFF
        if not self.is_ac:
            return HVACMode.HEAT
        return next((HVACMode(mode) for mode, value in AC_MODES.items() if value == self.state_data.get('runModel')), None)

    @property
    def current_temperature(self):
        """返回原厂报告的室温，不用设定温度替代室温。"""
        return self.state_data.get('roomTemperature' if self.is_ac else 'currentTemperature')

    @property
    def native_current_temperature(self):
        """兼容 HA 原生温度属性。"""
        return self.current_temperature

    @property
    def target_temperature(self):
        """返回设备实际设定温度。"""
        return self.state_data.get('settingTemperature')

    @property
    def native_target_temperature(self):
        """兼容 HA 原生目标温度属性。"""
        return self.target_temperature

    @property
    def fan_mode(self):
        """将原厂空调风速映射为 HA 标准风速。"""
        return next((name for name, value in AC_FANS.items() if value == self.state_data.get('fanSpeed')), None)

    async def async_set_hvac_mode(self, hvac_mode):
        """只修改所选设备的开关和工作模式。"""
        changes = {'on': hvac_mode != HVACMode.OFF}
        if self.is_ac and hvac_mode != HVACMode.OFF:
            changes['runModel'] = AC_MODES[hvac_mode]
        await self.coordinator.control(self.key, changes)

    async def async_set_temperature(self, **kwargs):
        """修改目标温度，保留当前开关和其他设置。"""
        await self.coordinator.control(self.key, {'settingTemperature': kwargs[ATTR_TEMPERATURE]})

    async def async_set_fan_mode(self, fan_mode):
        """仅修改空调风速。"""
        await self.coordinator.control(self.key, {'fanSpeed': AC_FANS[fan_mode]})

    async def async_turn_off(self):
        """关闭指定温控设备。"""
        await self.coordinator.control(self.key, {'on': False})

    async def async_turn_on(self):
        """沿用当前模式开启指定温控设备。"""
        await self.coordinator.control(self.key, {'on': True})

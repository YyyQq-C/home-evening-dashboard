"""控客实体通用身份和在线状态。"""
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from . import DOMAIN


class KonkeEntity(CoordinatorEntity):
    """使用原厂编号建立稳定身份，保留离线设备。"""

    def __init__(self, coordinator, entry, key):
        """绑定设备缓存并注册设备信息。"""
        super().__init__(coordinator)
        self.key = key
        device = coordinator.data[key]
        self._attr_unique_id = f'{entry.unique_id}_{key}'
        self._attr_name = device['name']
        self._attr_device_info = {'identifiers': {(DOMAIN, self._attr_unique_id)},
                                 'name': device['name'], 'manufacturer': '控客',
                                 'model': {'ac': '中央空调室内机', 'floor': '地暖通道', 'fresh': '新风设备'}[device['kind']]}

    @property
    def device(self):
        """返回当前设备缓存，删除或丢失时返回空记录。"""
        return self.coordinator.data.get(self.key, {})

    @property
    def state_data(self):
        """读取原厂设备状态，不触发网络操作。"""
        return self.device.get('state', {})

    @property
    def available(self):
        """仅在网关采集成功且设备在线时允许控制。"""
        return super().available and bool(self.device.get('online')) and bool(self.state_data)

    @property
    def extra_state_attributes(self):
        """公开原厂节点、地址和缓存时间以便核对实体。"""
        return {'konke_node_id': self.device.get('id'), 'konke_address': self.device.get('address'),
                'konke_state_updated': self.device.get('updated'), 'transport': 'ssh_tunnel'}

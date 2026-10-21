"""通过 HA 配置流程校验 SSH 连接与设备清单。"""
import logging
import voluptuous as vol
from homeassistant.config_entries import ConfigFlow
from homeassistant.helpers import selector
from . import DOMAIN
from .client import KonkeClient

LOGGER = logging.getLogger(__name__)


class KonkeConfigFlow(ConfigFlow, domain=DOMAIN):
    """创建控客 SSH 配置项并固定主机公钥。"""
    VERSION = 1

    async def async_step_import(self, user_input):
        """将已授权管理员的 YAML 配置导入正常配置项。"""
        result = await self.async_step_user(user_input)
        if result.get('type') == 'form':
            LOGGER.error('Konke YAML import validation failed')
            return self.async_abort(reason='cannot_connect')
        return result

    async def async_step_user(self, user_input=None):
        """验证连接后创建设备，不在验证期间发送控制指令。"""
        errors = {}
        if user_input is not None:
            await self.async_set_unique_id(user_input['host'])
            self._abort_if_unique_id_configured()
            client = KonkeClient(user_input)
            try:
                devices = await self.hass.async_add_executor_job(client.snapshot)
                if not devices:
                    raise ValueError('No supported Konke devices found')
            except Exception:
                LOGGER.exception('Konke configuration validation failed')
                errors['base'] = 'cannot_connect'
            finally:
                await self.hass.async_add_executor_job(client.close)
            if not errors:
                return self.async_create_entry(title='控客空调、地暖、新风', data=user_input)
        schema = vol.Schema({vol.Required('host'): vol.All(str, vol.Length(min=1)),
                             vol.Required('port', default=22): vol.All(int, vol.Range(min=1, max=65535)),
                             vol.Required('username', default='root'): str,
                             vol.Required('password'): selector.TextSelector(
                                 selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
                             vol.Required('host_key'): str})
        return self.async_show_form(step_id='user', data_schema=schema, errors=errors)

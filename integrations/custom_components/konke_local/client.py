"""通过已验证主机公钥的 SSH 隧道读取和控制控客原厂服务。"""
import base64
import json
import logging
import shlex
import threading
import time
import uuid

import paramiko

LOGGER = logging.getLogger(__name__)
SQLITE = '/rom/home/hj/smarthome/bin/sqlite3'
CONFIG_DB = '/etc/dropbear/accessory/hj_db/kk_db.db'
STATUS_DB = '/tmp/zigbee_dev_status.db'
AC_MODES = {'cool': 'COLD', 'heat': 'HOT', 'dry': 'DEHUMIDIFICATION', 'fan_only': 'AIR_SUPPLY', 'auto': 'AUTO'}
AC_FANS = {'auto': 'AUTO', 'low': 'LOW', 'medium': 'MID', 'high': 'HIGH'}


class KonkeClient:
    """串行管理 SSH 会话，禁止绕过原厂服务直接修改设备数据库。"""

    def __init__(self, config):
        """保存连接参数及线程锁，不在日志中输出登录凭据。"""
        self.config = config
        self.ssh = None
        self.lock = threading.RLock()

    def close(self):
        """关闭本组件建立的 SSH 连接。"""
        with self.lock:
            if self.ssh:
                self.ssh.close()
                self.ssh = None

    def _connect(self):
        """只信任配置中固定的控客主机公钥，并启用连接保活。"""
        if self.ssh and self.ssh.get_transport() and self.ssh.get_transport().is_active():
            return
        self.close()
        host = self.config['host']
        port = self.config.get('port', 22)
        kind, value = self.config['host_key'].split()[:2]
        key = paramiko.PKey.from_type_string(kind, base64.b64decode(value))
        self.ssh = paramiko.SSHClient()
        self.ssh.get_host_keys().add(host if port == 22 else f'[{host}]:{port}', kind, key)
        self.ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
        self.ssh.connect(host, port=port, username=self.config.get('username', 'root'),
                         password=self.config['password'], timeout=10, auth_timeout=10,
                         banner_timeout=10, look_for_keys=False, allow_agent=False)
        self.ssh.get_transport().set_keepalive(30)

    def _query(self, db, sql):
        """用只读 SQLite 查询取回分隔数据，保留中文名称和 JSON 原文。"""
        self._connect()
        # 原厂 SQLite 不支持 -readonly，使用只读查询模式并先确认文件存在。
        cmd = f'test -f {shlex.quote(db)} && {SQLITE} {shlex.quote(db)} {shlex.quote("PRAGMA query_only=ON; " + sql)}'
        _, out, err = self.ssh.exec_command(cmd, timeout=15)
        text = out.read().decode('utf-8')
        error = err.read().decode('utf-8', 'replace')
        if out.channel.recv_exit_status():
            LOGGER.error('Konke read-only query failed: %s', error)
            raise RuntimeError('Konke database query failed')
        return [line.split('|') for line in text.splitlines() if line]

    def snapshot(self):
        """读取真实室内机、已配置地暖通道及新风，在线状态来自原厂缓存。"""
        with self.lock:
            try:
                nodes = self._query(CONFIG_DB, 'SELECT id,channel,hex(name),operate_id,hex(mac) FROM all_node_config WHERE operate_id IN (16501,16502,17009,17010);')
                acs = self._query(CONFIG_DB, 'SELECT id,indoorunit_addr,bind_central_ac_gw_devid,hex(name),hex(status) FROM all_central_ac_indoorunit;')
                rows = self._query(STATUS_DB, 'SELECT node_id,opcode,hex(arg),online,update_time FROM all_device_status;')
                statuses = {int(row[0]): {'state': json.loads(bytes.fromhex(row[2]).decode()), 'time': row[4]} for row in rows if row[2]}
                managers = {}
                for node, channel, name, operate, mac in nodes:
                    if int(operate) in (16501, 17009):
                        managers[mac] = statuses.get(int(node), {}).get('state', [])
                result = {}
                for node, address, gateway, name, raw in acs:
                    state = json.loads(bytes.fromhex(raw).decode()) if raw else {}
                    result['ac_' + node] = {'kind': 'ac', 'id': node, 'address': int(address), 'gateway': gateway,
                                            'name': f'控客 空调 {address}', 'online': bool(state.get('online', False)), 'state': state}
                for node, channel, name, operate, mac in nodes:
                    if int(operate) not in (16502, 17010):
                        continue
                    kind = 'floor' if int(operate) == 16502 else 'fresh'
                    address = int(channel) - 1
                    cache = statuses.get(int(node), {})
                    state = cache.get('state', {})
                    if not isinstance(state, dict):
                        state = {}
                    online = next((bool(s.get('online')) for s in managers.get(mac, []) if s.get('address') == address), False)
                    result[kind + '_' + node] = {'kind': kind, 'id': node, 'address': address,
                        'name': f'控客 {"地暖" if kind == "floor" else "新风"} {address}',
                        'online': online, 'state': state, 'updated': cache.get('time')}
                return result
            except Exception:
                LOGGER.exception('Konke state refresh failed')
                self.close()
                raise

    @staticmethod
    def _receive(channel, deadline, pending):
        """按原厂起止符组帧，处理分片和同一次接收中的多条消息。"""
        while time.monotonic() < deadline:
            start = pending.find(b'!')
            end = pending.find(b'$', start + 1) if start >= 0 else -1
            if start >= 0 and end >= 0:
                return json.loads(pending[start + 1:end]), pending[end + 1:]
            channel.settimeout(max(0.1, deadline - time.monotonic()))
            chunk = channel.recv(65536)
            if not chunk:
                raise ConnectionError('Konke protocol connection closed')
            pending += chunk
            if len(pending) > 1048576:
                raise ValueError('Konke protocol frame too large')
        raise TimeoutError('Konke protocol response timed out')

    def request(self, opcode, node, arg, destination='HJ_Server'):
        """通过 SSH 回环转发登录原厂服务，并验证目标命令的明确响应。"""
        with self.lock:
            channel = None
            try:
                self._connect()
                channel = self.ssh.get_transport().open_channel('direct-tcpip', ('127.0.0.1', 5000), ('127.0.0.1', 0), timeout=10)
                login = {'opcode': 'LC_LOGIN', 'arg': {'username': 'local', 'password': 'local'}}
                channel.sendall(('!' + json.dumps(login, separators=(',', ':')) + '$').encode())
                deadline = time.monotonic() + 10
                pending = b''
                while True:
                    message, pending = self._receive(channel, deadline, pending)
                    if message.get('opcode') == 'LC_LOGIN':
                        if message.get('status') != 'success':
                            raise PermissionError('Konke local protocol login failed')
                        break
                payload = {'opcode': opcode, 'nodeid': str(node), 'arg': arg, 'requester': destination, 'reqId': uuid.uuid4().hex}
                channel.sendall(('!' + json.dumps(payload, separators=(',', ':')) + '$').encode())
                deadline = time.monotonic() + 20
                while True:
                    message, pending = self._receive(channel, deadline, pending)
                    if str(message.get('nodeid')) == str(node) and message.get('opcode') == opcode:
                        if message.get('status') != 'success':
                            LOGGER.error('Konke device command rejected: node=%s opcode=%s', node, opcode)
                            raise RuntimeError('Konke device rejected command')
                        return message
            except Exception:
                LOGGER.exception('Konke protocol request failed: node=%s opcode=%s', node, opcode)
                raise
            finally:
                if channel:
                    channel.close()

    def control(self, key, changes):
        """依据最新状态构建单设备命令，保留未修改的空调设置。"""
        with self.lock:
            device = self.snapshot()[key]
            if not device['online']:
                raise ConnectionError('Konke device is offline')
            state = device['state']
            kind = device['kind']
            if kind == 'ac':
                arg = {k: state[k] for k in ('on', 'runModel', 'fanSpeed', 'settingTemperature')}
                arg.update(changes)
                if not 16 <= float(arg['settingTemperature']) <= 32:
                    raise ValueError('Air conditioner temperature is out of range')
                if arg['runModel'] not in AC_MODES.values() or arg['fanSpeed'] not in AC_FANS.values():
                    raise ValueError('Unsupported air conditioner settings')
                return self.request('CENTRAL_AC_INDOOR_UNIT_SETTING', device['id'], arg, 'HJ_CentralAC')
            if len(changes) != 1:
                raise ValueError('Only one device setting may be changed per command')
            setting, value = next(iter(changes.items()))
            if setting == 'on':
                opcode, arg = 'SWITCH', 'ON' if value else 'OFF'
            elif kind == 'floor' and setting == 'settingTemperature':
                if not 5 <= float(value) <= 45:
                    raise ValueError('Floor heating temperature is out of range')
                opcode, arg = 'SET_FLOOR_HEATING_DEV_TEMPERATURE', str(float(value))
            elif kind == 'fresh' and setting == 'speed':
                if int(value) not in (1, 2, 3):
                    raise ValueError('Unsupported fresh air speed')
                opcode, arg = 'SET_FRESH_AIR_SPEED', str(int(value))
            else:
                raise ValueError('Unsupported Konke setting')
            return self.request(opcode, device['id'], arg)

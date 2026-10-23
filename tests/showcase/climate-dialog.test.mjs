import './setup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

/** 提供弹窗渲染所需的最小文档桩，不连接浏览器或真实设备。 */
function installDocument() {
  const host = {
    hidden: true,
    innerHTML: '',
    contains() { return false; },
    querySelector(selector) {
      if (selector === '.climate-body') return { scrollTop: 0 };
      if (selector.startsWith('[data-climate-key')) return { disabled: false, focus() {} };
      return null;
    },
    addEventListener() {},
  };
  const screen = { children: [host, { id: 'standby', hidden: true, inert: false }] };
  globalThis.document = {
    activeElement: null,
    querySelector(selector) {
      if (selector === '#climate-layer') return host;
      if (selector === '#screen') return screen;
      if (selector === '#standby') return screen.children[1];
      return null;
    },
    addEventListener() {},
  };
  return host;
}

const host = installDocument();
const { createClimateDialog } = await import('../../www/home-evening/climate-dialog.js');

/** 打开客厅空调并返回弹窗 HTML，记录是否发生状态回调。 */
function renderDialog(reading, item) {
  const state = { ac: { living: { on: false, temperature: 19, mode: '自动', fan: '高速', ...item } } };
  const calls = [];
  const dialog = createClimateDialog({
    state,
    getDrafts: () => ({}),
    onChange: () => calls.push('change'),
    onTemperatureChange: () => calls.push('temperature'),
    getReading: () => reading,
    onPrepare: () => calls.push('prepare'),
    isSimulated: () => false,
  });
  dialog.open({ kind: 'ac', id: 'living', label: '客厅空调' });
  return { html: host.innerHTML, state, calls };
}

/** 取出某一类选项按钮的值和选中状态。 */
function buttons(html, action) {
  return [...html.matchAll(new RegExp(`data-climate-action="${action}" data-value="([^"]+)"[^>]*aria-pressed="(true|false)"`, 'g'))]
    .map(match => ({ value: match[1], pressed: match[2] === 'true' }));
}

test('运行模式不再提供自动，风速仍保留自动', () => {
  const { html, calls } = renderDialog({ available: true, status: '已关闭', temperature: 19, min: 16, max: 32, mode: '制冷', fan: '高速' });
  assert.deepEqual(buttons(html, 'mode').map(button => button.value), ['制冷', '制热', '除湿', '送风']);
  assert.deepEqual(buttons(html, 'fan').map(button => button.value), ['自动', '低速', '中速', '高速']);
  assert.equal(calls.length, 0);
});

test('当前运行模式为自动时不点亮其他模式，也不改写或下发', () => {
  const { html, state, calls } = renderDialog({ available: true, status: '已关闭', temperature: 19, min: 16, max: 32, mode: '自动', fan: '自动' });
  const modes = buttons(html, 'mode');
  assert.equal(modes.some(button => button.value === '自动'), false);
  assert.equal(modes.some(button => button.pressed), false);
  assert.equal(buttons(html, 'fan').find(button => button.value === '自动').pressed, true);
  assert.equal(state.ac.living.mode, '自动');
  assert.equal(calls.length, 0);
  assert.match(html, /真实状态只读同步，操作不会下发设备/);
});

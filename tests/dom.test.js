/**
 * 行为测试：用 jsdom 加载真实的 index.html，驱动完整的用户交互流程。
 * 运行：npm test   （等价于 node tests/dom.test.js）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const STORAGE_KEY = 'what-to-eat-today.v1';
const URL_ = 'https://what-to-eat-today.example/';

let pass = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) {
    pass += 1;
    console.log(`  \u2713 ${label}`);
  } else {
    failures.push(label);
    console.log(`  \u2717 ${label}${extra ? '  \u2192 ' + extra : ''}`);
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, label, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

function section(title) {
  console.log(`\n${title}`);
}

/** 建一个页面实例；prefill 写入 localStorage，用来模拟「关掉网页再打开」。 */
function open({ prefill = null, randomQueue = null } = {}) {
  const dom = new JSDOM(HTML, {
    url: URL_,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.__EAT_SPIN_MS = 0; // 测试里不真的等 4 秒动画
      if (prefill !== null) win.localStorage.setItem(STORAGE_KEY, prefill);
      if (randomQueue) {
        const queue = randomQueue.slice();
        win.Math.random = () => (queue.length ? queue.shift() : 0.5);
      }
    }
  });
  const win = dom.window;
  const doc = win.document;
  return {
    dom,
    win,
    doc,
    $: (id) => doc.getElementById(id),
    stored: () => JSON.parse(win.localStorage.getItem(STORAGE_KEY)),
    names: () => win.EatDecider.getState().items.map((i) => i.name),
    listNames: () => [...doc.querySelectorAll('#items li .nm')].map((n) => n.textContent),
    click(el) {
      el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    press(el, key, code) {
      el.dispatchEvent(new win.KeyboardEvent('keydown', { key, code: code || key, bubbles: true, cancelable: true }));
    },
    addFood(text) {
      const input = doc.getElementById('add-input');
      input.value = text;
      doc.getElementById('add-btn').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    // 最新一条提示里的动作按钮（撤销）
    toastButton: () => {
      const boxes = doc.querySelectorAll('#toasts .toast');
      const last = boxes[boxes.length - 1];
      return last ? last.querySelector('button') : null;
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    close: () => dom.window.close()
  };
}

const DEFAULTS = ['火锅', '兰州拉面', '小笼包', '麻辣烫', '黄焖鸡米饭'];

(async function run() {
  section('1. 首次打开：默认 5 样中国美食');
  {
    const p = open();
    eq(p.names().length, 5, '默认清单 5 样');
    eq(p.names().join(','), DEFAULTS.join(','), '默认内容与顺序正确');
    eq(p.$('stat-count').textContent, '5', '统计显示候选 5 样');
    eq(p.$('list-count').textContent, '5 / 30', '计数显示 5 / 30');
    eq(p.$('items').querySelectorAll('li').length, 5, '清单 DOM 渲染 5 行');
    eq(p.$('wheel').querySelectorAll('.label').length, 5, '转盘渲染 5 个扇区标签');
    ok(p.$('wheel-empty').hidden, '有数据时不显示空状态');
    eq(p.$('result-name').textContent, '等你转一下', '初始不预填结果');
    ok(!p.$('hub').disabled, '转盘按钮可用');
    eq(p.$('add-input').value, '', '输入框初始为空');
    ok(p.$('add-input').getAttribute('maxlength') === '24', '输入框限制 24 字');
    p.close();
  }

  section('2. 添加食物');
  {
    const p = open();
    p.addFood('螺蛳粉');
    eq(p.names().length, 6, '点添加后变成 6 样');
    ok(p.names().includes('螺蛳粉'), '新食物写入状态');
    eq(p.$('add-input').value, '', '添加后清空输入框');
    eq(p.$('list-count').textContent, '6 / 30', '计数同步更新');
    eq(p.stored().items.length, 6, '已持久化到 localStorage');
    eq(p.stored().items[5].name, '螺蛳粉', '持久化内容正确');
    ok(p.stored().items[5].emoji.length > 0, '自动配了 emoji');

    p.addFood(' 水煮鱼 ');
    ok(p.names().includes('水煮鱼'), '自动去掉首尾空格');
    eq(p.$('result-name').textContent, '等你转一下', '添加不会改动结果区');

    p.addFood('螺蛳粉');
    eq(p.names().length, 7, '重复名字被拒绝');
    ok(p.$('toasts').textContent.includes('已经在清单里'), '给出重复提示');

    p.addFood('   ');
    eq(p.names().length, 7, '空白输入被拒绝');

    p.doc.getElementById('add-input').value = '奶茶';
    p.press(p.$('add-input'), 'Enter');
    ok(p.names().includes('奶茶'), '输入框按下 Enter 也能添加');

    p.click(p.$('chips').querySelectorAll('button')[0]);
    eq(p.names().length, 9, '点击推荐 chip 直接加入');
    p.close();
  }

  section('3. 删除 + 撤销');
  {
    const p = open();
    p.addFood('螺蛳粉');
    const row = p.$('items').querySelector('li[data-id="' + p.win.EatDecider.getState().items[5].id + '"]');
    p.click(row.querySelector('.del'));
    eq(p.names().length, 5, '删除后剩 5 样');
    ok(!p.names().includes('螺蛳粉'), '被删的食物不在清单里');
    eq(p.stored().items.length, 5, '删除已持久化');
    ok(p.$('toasts').textContent.includes('已删掉'), '出现删除提示');

    const undo = p.toastButton();
    ok(!!undo && undo.textContent === '撤销', '提示里带撤销按钮');
    p.click(undo);
    eq(p.names().length, 6, '撤销后恢复 6 样');
    eq(p.names()[5], '螺蛳粉', '撤销恢复到原来的位置');
    eq(p.stored().items.length, 6, '撤销后重新持久化');

    // 删中间的，撤销要插回原位
    const midId = p.win.EatDecider.getState().items[2].id;
    p.click(p.$('items').querySelector('li[data-id="' + midId + '"] .del'));
    p.click(p.toastButton());
    eq(p.names()[2], '小笼包', '撤销放回中间原位置');
    eq(p.names().length, 6, '撤销后数量不变');
    p.close();
  }

  section('4. 清空 / 恢复默认');
  {
    const p = open();
    p.click(p.$('clear-btn'));
    eq(p.names().length, 0, '清空后清单为空');
    ok(!p.$('empty-note').hidden, '显示空清单提示');
    ok(!p.$('wheel-empty').hidden, '转盘显示空状态');
    ok(p.$('hub').disabled, '空清单时不允许转动');
    eq(p.stored().items.length, 0, '空清单也要持久化（重开不该复活默认值）');
    eq(p.$('items').querySelectorAll('li').length, 0, '清单 DOM 也清空');
    eq(p.$('wheel').querySelectorAll('.label').length, 0, '转盘扇区清空');

    p.click(p.toastButton());
    eq(p.names().length, 5, '清空也能撤销');

    p.addFood('螺蛳粉');
    p.click(p.$('reset-btn'));
    eq(p.names().join(','), DEFAULTS.join(','), '恢复默认回到 5 样中国美食');
    eq(p.stored().items.length, 5, '恢复默认已持久化');
    p.close();
  }

  section('5. 关掉网页再打开，数据还在');
  {
    const first = open();
    first.addFood('螺蛳粉');
    first.addFood('小龙虾');
    first.win.EatDecider.remove(first.win.EatDecider.getState().items[0].id); // 删掉「火锅」
    const saved = first.win.localStorage.getItem(STORAGE_KEY);
    const before = first.names();
    first.close();

    const second = open({ prefill: saved });
    eq(second.names().join(','), before.join(','), '重新打开后清单完全一致');
    eq(second.$('items').querySelectorAll('li').length, before.length, '重新打开后 DOM 一致');
    ok(!second.names().includes('火锅'), '被删掉的不会复活');
    ok(second.names().includes('小龙虾'), '后加的食物还在');
    eq(second.stored().items.length, before.length, '重开后再次读写存储正常');
    second.close();
  }

  section('5b. 重开后上次的结果仍然留在台面上');
  {
    const first = open({ randomQueue: [0.45, 0.5] }); // → 小笼包
    first.click(first.$('hub'));
    await first.wait(200);
    const saved = first.win.localStorage.getItem(STORAGE_KEY);
    first.close();

    const again = open({ prefill: saved });
    eq(again.$('result-name').textContent, '小笼包', '重开后结果区显示上次抽到的');
    ok(again.$('result-key').textContent.includes('上次'), '结果区标题说明这是上次的结果');
    ok(again.$('result-emoji').textContent.length > 0, '重开后结果区仍有 emoji');
    eq(again.$('stat-spins').textContent, '1', '重开后转动次数保留');
    eq(again.$('history').querySelectorAll('li').length, 1, '重开后历史保留');

    // 没有历史时仍然是邀请状态
    const fresh = open();
    eq(fresh.$('result-name').textContent, '等你转一下', '新访客仍然是「等你转一下」');
    eq(fresh.$('result-key').textContent.trim().toLowerCase(), "today’s pick", '新访客的结果标题为 today’s pick');
    fresh.close();
    again.close();
  }

  section('6. 转动决定（结果、角度与缓存都对）');  {
    const p = open({ randomQueue: [0, 0.5, 0.5, 0.5] }); // 第一次 winner = floor(0 * 5) = 0；第二次 = floor(0.5 * 5) = 2
    p.click(p.$('hub'));
    ok(p.win.EatDecider.isSpinning(), '点击后进入转动状态');
    ok(p.$('hub').disabled, '转动中按钮禁用防连点');
    await p.wait(200);
    ok(!p.win.EatDecider.isSpinning(), '转动结束');
    eq(p.$('result-name').textContent, '火锅', '结果区显示抽中的那一样');
    ok(p.$('result-name').classList.contains('pop'), '结果有弹出动画类');
    ok(p.$('result-emoji').textContent.length > 0, '结果区显示 emoji');
    eq(p.$('stat-spins').textContent, '1', '累计转过 1 次');
    eq(p.stored().spins, 1, '次数已持久化');
    eq(p.stored().history[0].name, '火锅', '结果进入历史');
    eq(p.$('history').querySelectorAll('li').length, 1, '历史列表渲染 1 条');
    ok(p.$('history-note').hidden, '有历史时隐藏占位文案');
    ok(p.$('wheel').querySelector('.label[data-index="0"]').classList.contains('win'), '命中的扇区被高亮');
    ok(p.$('items').querySelector('li[data-index="0"]').classList.contains('hit'), '清单里对应那条被高亮');
    ok(p.$('wheel').querySelector('.highlight').classList.contains('on'), '转盘高亮层打开');
    eq(p.$('hub').textContent, '再转一次', '按钮文案切换');

    // 角度数学：转完后命中的扇区中心必须正对顶部指针（误差小于半个扇区）
    const angle = ((p.win.EatDecider.getRotation() % 360) + 360) % 360;
    const center = 0.5 * (360 / 5);
    const delta = (((center + angle) % 360) + 360) % 360;
    const half = 360 / 5 / 2;
    ok(delta < half, `指针落在抽中的扇区内（偏差 ${delta.toFixed(2)}°，半扇区 ${half.toFixed(2)}°）`);

    p.click(p.$('hub'));
    await p.wait(200);
    eq(p.$('stat-spins').textContent, '2', '第二次转动累计到 2');
    eq(p.stored().history.length, 2, '历史累积 2 条');
    eq(p.$('result-name').textContent, '小笼包', '第二次结果由新的随机数决定');
    eq(p.stored().history[0].name, '小笼包', '最新一条历史在最前面');
    eq(p.$('wheel').querySelector('.label[data-index="2"]').classList.contains('win'), true, '第二次命中第 3 个扇区');
    p.close();
  }

  section('7. 只剩一样时必定抽中它 / 空清单点击不炸');
  {
    const p = open();
    while (p.win.EatDecider.getState().items.length > 1) {
      p.win.EatDecider.remove(p.win.EatDecider.getState().items[1].id);
    }
    eq(p.names().join(','), '火锅', '只留 1 样');
    p.click(p.$('hub'));
    await p.wait(200);
    eq(p.$('result-name').textContent, '火锅', '唯一选项必定抽中');
    ok(p.$('wheel-empty').hidden, '只剩 1 样也不是空状态');

    p.click(p.$('clear-btn'));
    ok(p.$('hub').disabled, '空清单时按钮禁用');
    p.press(p.win.document.body, ' ', 'Space');
    eq(p.$('stat-spins').textContent, '1', '空清单时空格不会增加转动次数');
    ok(p.$('toasts').textContent.length > 0, '空清单时空格给出提示');
    p.close();
  }

  section('8. 键盘空格 / 音效开关 / 数据卫生');
  {
    const p = open({ randomQueue: [0.45, 0.5] }); // winner = floor(0.45 * 5) = 2 → 小笼包
    p.press(p.win.document.body, ' ', 'Space');
    await p.wait(200);
    eq(p.$('result-name').textContent, '小笼包', '空格键触发转动并给出结果');

    eq(p.$('sound-btn').getAttribute('aria-pressed'), 'true', '音效默认开启');
    p.click(p.$('sound-btn'));
    eq(p.stored().sound, false, '关闭音效已持久化');
    eq(p.$('sound-btn').textContent, '♪ 静音', '按钮文案反映静音状态');
    p.close();

    // 输入框里敲空格不应该触发转动
    const q = open({ randomQueue: [0, 0.5] });
    q.press(q.$('add-input'), ' ', 'Space');
    eq(q.$('stat-spins').textContent, '0', '在输入框里按空格不会转动');

    // 脏数据：标签注入、超长名字、坏 JSON 都要能兜住
    q.addFood('红烧肉<img src=x onerror=alert(1)>');
    const dirty = q.win.EatDecider.getState().items.slice(-1)[0].name;
    ok(!/[<>]/.test(dirty), '名字里的尖括号被清洗');
    ok(q.$('items').innerHTML.indexOf('<img') === -1, '不会把输入当 HTML 插入');
    ok(q.$('items').textContent.includes('红烧肉'), '清洗后仍保留正常文字');

    q.addFood('超'.repeat(80));
    const longName = q.win.EatDecider.getState().items.slice(-1)[0].name;
    ok(longName.length <= 24, '超长名字被截断到 24 字以内');

    const broken = open({ prefill: '{ not json at all' });
    eq(broken.names().join(','), DEFAULTS.join(','), '存储损坏时回退到默认清单');

    const partial = open({
      prefill: JSON.stringify({ version: 1, sound: false, spins: 7, history: [{ name: '火锅', at: Date.now() }] })
    });
    eq(partial.names().join(','), DEFAULTS.join(','), '缺少 items 字段时补上默认清单');
    eq(partial.$('stat-spins').textContent, '7', '保留历史转动次数');
    eq(partial.$('history').querySelectorAll('li').length, 1, '保留历史记录');
    eq(partial.$('sound-btn').textContent, '♪ 静音', '保留音效开关状态');

    const junkItems = open({ prefill: JSON.stringify({ items: [null, { name: '   ' }, { name: '烧烤' }] }) });
    eq(junkItems.names().join(','), '烧烤', '过滤掉非法条目，保留合法项');

    q.close();
    broken.close();
    partial.close();
    junkItems.close();
  }

  section('9. 上限保护');
  {
    const p = open();
    for (let i = 0; i < 40; i += 1) p.addFood('菜' + i);
    eq(p.names().length, 30, '最多只保留 30 样');
    eq(p.$('list-count').textContent, '30 / 30', '计数显示 30 / 30');
    ok(p.$('toasts').textContent.includes('最多放'), '超出时给出提示');
    eq(p.stored().items.length, 30, '上限也持久化一致');
    eq(p.$('wheel').querySelectorAll('.label').length, 30, '30 样时转盘仍然完整渲染');
    p.close();
  }

  console.log(`\n${'='.repeat(52)}`);
  console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
  if (failures.length) {
    failures.forEach((f) => console.log('  - ' + f));
    process.exitCode = 1;
  }
})();

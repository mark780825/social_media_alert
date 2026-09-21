/**
 * 內建清單資料的驗證：確認每筆都能被正確比對，
 * 而且「應排除」的同名粉專不會誤發警示。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

require('../src/common/matcher.js');
const SMA = globalThis.SMA;

const payload = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'default-list.json'), 'utf8')
);
const entries = payload.entries.map((item) =>
  SMA.normalizeEntryInput(Object.assign({}, item, { source: 'builtin' }))
);
const index = SMA.buildIndex(entries);

function alertsFor(url) {
  return SMA.splitMatches(SMA.matchUrl(index, url).matches, 'info').alerts;
}

function clearedFor(url) {
  return SMA.splitMatches(SMA.matchUrl(index, url).matches, 'info').cleared;
}

function alertsForName(name) {
  return SMA.splitMatches(SMA.matchNames(index, [name]), 'info').alerts;
}

function clearedForName(name) {
  return SMA.splitMatches(SMA.matchNames(index, [name]), 'info').cleared;
}

test('清單共 43 筆，每筆都是有效項目', () => {
  assert.strictEqual(entries.length, 43);
  entries.forEach((entry) => {
    assert.ok(SMA.isValidEntry(entry), (entry.name || '(無名稱)') + ' 缺少可比對的識別資訊');
    assert.ok(SMA.LEVELS[entry.level], (entry.name || '') + ' 的等級不合法：' + entry.level);
  });
});

test('分級筆數符合來源清冊', () => {
  const count = entries.reduce((acc, entry) => {
    acc[entry.level] = (acc[entry.level] || 0) + 1;
    return acc;
  }, {});
  assert.deepStrictEqual(count, { danger: 10, warning: 18, info: 10, safe: 5 });
});

test('每筆都有註明依據', () => {
  entries.forEach((entry) => {
    assert.ok(entry.reason && entry.reason.length > 0, (entry.name || '') + ' 沒有填寫依據');
  });
});

test('有網址代號的項目可用網址比對到', () => {
  assert.strictEqual(alertsFor('https://www.facebook.com/Taipei.Info')[0].level, 'warning');
  assert.strictEqual(alertsFor('https://www.facebook.com/zmyqqlv')[0].level, 'warning');
  assert.strictEqual(alertsFor('https://www.facebook.com/LIFE.com.tw')[0].level, 'info');
  assert.strictEqual(alertsFor('https://www.facebook.com/enews.com.tw/posts/123')[0].level, 'warning');
});

test('數字 ID 形式的粉專可以比對', () => {
  const hits = alertsFor('https://www.facebook.com/profile.php?id=100057876810769');
  assert.strictEqual(hits.length, 1);
  assert.match(hits[0].name, /好康道相報/);
});

test('只有名稱的高風險項目可用名稱比對到', () => {
  ['靠北醫生', '舊時光', '愛經驗', 'buzzhand', '每日正能量', 'omg快報', '50+健康生活']
    .forEach((name) => {
      const hits = alertsForName(name);
      assert.strictEqual(hits.length, 1, name + ' 應該要命中');
      assert.strictEqual(hits[0].level, 'danger');
      assert.strictEqual(hits[0]._viaName, true);
    });
});

test('反萊豬粉專與社團兩筆都會被名稱比對到', () => {
  const hits = alertsForName('反萊豬 我＋1');
  assert.strictEqual(hits.length, 2);
  hits.forEach((hit) => assert.strictEqual(hit.level, 'danger'));
});

test('應排除的同名粉專不會發出警示', () => {
  // 臺北市政府官方
  assert.strictEqual(alertsForName('Humans of Taipei 我是台北人').length, 0);
  assert.strictEqual(clearedForName('Humans of Taipei 我是台北人').length, 1);

  // 台灣本來就有的匿名投稿粉專
  ['靠北婆婆', '靠北婆家', '靠北老公'].forEach((name) => {
    assert.strictEqual(alertsForName(name).length, 0, name + ' 不該被警示');
    assert.strictEqual(clearedForName(name).length, 1, name + ' 應標為已澄清');
  });

  // 網址代號不同的同名粉專
  assert.strictEqual(alertsFor('https://www.facebook.com/i.Taoyuan').length, 0);
  assert.strictEqual(clearedFor('https://www.facebook.com/i.Taoyuan').length, 1);
  assert.strictEqual(alertsFor('https://www.facebook.com/MyHsinchu').length, 0);
});

test('LIFE 的我是桃園人與 i.Taoyuan 不會互相混淆', () => {
  assert.strictEqual(alertsFor('https://www.facebook.com/Taoyuan.Info').length, 1);
  assert.strictEqual(alertsFor('https://www.facebook.com/i.Taoyuan').length, 0);
});

test('「我是 OO 人」不使用名稱比對，避免誤標同名粉專', () => {
  assert.strictEqual(SMA.matchNames(index, ['我是台北人']).length, 0);
  assert.strictEqual(SMA.matchNames(index, ['我是桃園人']).length, 0);
});

test('社群回報並查證後新增的兩筆可以比對到', () => {
  const penghu = alertsFor('https://www.facebook.com/Penghu.Info');
  assert.strictEqual(penghu.length, 1);
  assert.strictEqual(penghu[0].level, 'warning');

  // 檢舉來源的網址帶有子路徑，應該仍解析得到粉專代號
  const miaoli = alertsFor('https://www.facebook.com/Miaoli.Info/directory_links');
  assert.strictEqual(miaoli.length, 1);
  assert.strictEqual(miaoli[0].level, 'warning');
});

test('新增兩筆的依據載明管理端在台灣，不得寫成境外管理', () => {
  ['penghu.info', 'miaoli.info'].forEach((handle) => {
    const entry = entries.find((e) => e.handle === handle);
    assert.ok(/均在台灣/.test(entry.reason), handle + ' 的依據應載明管理人員所在地');
    assert.ok(!/境外管理/.test((entry.tags || []).join('')), handle + ' 不應標上境外管理');
  });
});

test('「我是 OO 人」系列仍不使用名稱比對', () => {
  ['我是澎湖人', '我是苗栗人'].forEach((name) => {
    assert.strictEqual(SMA.matchNames(index, [name]).length, 0,
      name + ' 應只以網址代號比對，避免誤標同名粉專');
  });
});

test('沒被列入的粉專不會命中', () => {
  assert.strictEqual(alertsFor('https://www.facebook.com/some.random.page').length, 0);
  assert.strictEqual(alertsForName('某個沒被點名的粉專').length, 0);
});

test('清單檔有註明來源、缺口與免責聲明', () => {
  assert.ok(Array.isArray(payload.sources) && payload.sources.length > 0);
  assert.ok(Array.isArray(payload.gaps) && payload.gaps.length > 0);
  assert.ok(payload.disclaimer && payload.disclaimer.length > 0);
});

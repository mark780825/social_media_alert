/**
 * 網址解析與清單比對的單元測試。
 * 執行方式：node --test test/
 */
const test = require('node:test');
const assert = require('node:assert');

require('../src/common/matcher.js');
const SMA = globalThis.SMA;

test('解析 Facebook 粉專網址', () => {
  const target = SMA.parseProfileTarget('https://www.facebook.com/some.page/');
  assert.deepStrictEqual(target.platform, 'facebook');
  assert.strictEqual(target.kind, 'handle');
  assert.strictEqual(target.value, 'some.page');
});

test('解析 Facebook 貼文網址時仍取得粉專帳號', () => {
  const target = SMA.parseProfileTarget('https://www.facebook.com/Some.Page/posts/pfbid123');
  assert.strictEqual(target.value, 'some.page');
});

test('解析 profile.php 的數字 ID', () => {
  const target = SMA.parseProfileTarget('https://www.facebook.com/profile.php?id=100001234567890');
  assert.strictEqual(target.kind, 'id');
  assert.strictEqual(target.value, '100001234567890');
});

test('解析 /people/ 形式的網址', () => {
  const target = SMA.parseProfileTarget('https://www.facebook.com/people/Some-Name/61550000000000/');
  assert.strictEqual(target.kind, 'id');
  assert.strictEqual(target.value, '61550000000000');
});

test('解析 Facebook 外連跳轉 l.php', () => {
  const inner = encodeURIComponent('https://www.threads.com/@someone');
  const target = SMA.parseProfileTarget('https://l.facebook.com/l.php?u=' + inner);
  assert.strictEqual(target.platform, 'threads');
  assert.strictEqual(target.value, 'someone');
});

test('保留路徑不會被誤判為帳號', () => {
  ['https://www.facebook.com/watch/?v=1',
    'https://www.facebook.com/marketplace/item/1',
    'https://www.facebook.com/messages/t/1',
    'https://www.facebook.com/story.php?story_fbid=1'].forEach((url) => {
    assert.strictEqual(SMA.parseProfileTarget(url), null, url + ' 應被忽略');
  });
});

test('解析 Threads 帳號與貼文', () => {
  assert.strictEqual(SMA.parseProfileTarget('https://www.threads.net/@someone').value, 'someone');
  assert.strictEqual(SMA.parseProfileTarget('https://www.threads.com/@Someone/post/abc').value, 'someone');
});

test('非社群網址回傳 null', () => {
  assert.strictEqual(SMA.parseProfileTarget('https://example.com/some.page'), null);
});

test('索引比對可找到對應項目', () => {
  const entries = [
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'Bad.Page', level: 'danger', reason: '詐騙' }),
    SMA.normalizeEntryInput({ platform: 'threads', handle: '@bad_user', level: 'warning' })
  ];
  const index = SMA.buildIndex(entries);

  const fb = SMA.matchUrl(index, 'https://www.facebook.com/bad.page/posts/1');
  assert.strictEqual(fb.matches.length, 1);
  assert.strictEqual(fb.matches[0].reason, '詐騙');

  const th = SMA.matchUrl(index, 'https://www.threads.com/@bad_user');
  assert.strictEqual(th.matches.length, 1);

  const clean = SMA.matchUrl(index, 'https://www.facebook.com/good.page');
  assert.strictEqual(clean.matches.length, 0);
});

test('platform 為 any 時兩個平台都會命中', () => {
  const index = SMA.buildIndex([SMA.normalizeEntryInput({ platform: 'any', handle: 'shared_name' })]);
  assert.strictEqual(SMA.matchUrl(index, 'https://www.facebook.com/shared_name').matches.length, 1);
  assert.strictEqual(SMA.matchUrl(index, 'https://www.threads.net/@shared_name').matches.length, 1);
});

test('多筆命中時高風險排在前面', () => {
  const index = SMA.buildIndex([
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'dup', level: 'info' }),
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'dup', level: 'danger' })
  ]);
  const result = SMA.matchUrl(index, 'https://www.facebook.com/dup');
  assert.strictEqual(result.matches.length, 2);
  assert.strictEqual(result.matches[0].level, 'danger');
  assert.strictEqual(SMA.highestLevel(result.matches), 'danger');
});

test('直接貼上網址也能建立清單項目', () => {
  const entry = SMA.normalizeEntryInput({ handle: 'https://www.facebook.com/profile.php?id=123456' });
  assert.strictEqual(entry.platform, 'facebook');
  assert.strictEqual(entry.profileId, '123456');
  assert.ok(SMA.isValidEntry(entry));
});

test('沒有任何識別資訊的項目視為無效', () => {
  assert.strictEqual(SMA.isValidEntry(SMA.normalizeEntryInput({ name: '只有名字' })), false);
});

test('以粉專名稱比對，命中的項目會標上 _viaName', () => {
  const index = SMA.buildIndex([
    SMA.normalizeEntryInput({ platform: 'facebook', nameMatch: ['靠北醫生'], level: 'danger', reason: 'DSET 具名' })
  ]);
  const hits = SMA.matchNames(index, ['靠北醫生 | Facebook'.replace(' | Facebook', ''), '其他名稱']);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0]._viaName, true);
  assert.strictEqual(hits[0].reason, 'DSET 具名');
});

test('名稱比對會忽略空白與全形符號差異', () => {
  const index = SMA.buildIndex([
    SMA.normalizeEntryInput({ platform: 'facebook', nameMatch: ['反萊豬 我+1'], level: 'danger' })
  ]);
  assert.strictEqual(SMA.matchNames(index, ['反萊豬我＋1']).length, 1);
  assert.strictEqual(SMA.matchNames(index, ['反萊豬 我 ＋ 1']).length, 1);
  assert.strictEqual(SMA.matchNames(index, ['反萊豬我+2']).length, 0);
});

test('只有名稱的項目視為有效，且不會被當成網址代號', () => {
  const entry = SMA.normalizeEntryInput({ platform: 'facebook', nameMatch: ['每日正能量'] });
  assert.ok(SMA.isValidEntry(entry));
  assert.strictEqual(entry.handle, '');
  const index = SMA.buildIndex([entry]);
  assert.strictEqual(SMA.matchUrl(index, 'https://www.facebook.com/每日正能量').matches.length, 0);
});

test('splitMatches 把已澄清項目與警示分開', () => {
  const entries = [
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'taoyuan.info', level: 'warning' }),
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'i.taoyuan', level: 'safe' })
  ];
  const index = SMA.buildIndex(entries);

  const flagged = SMA.splitMatches(SMA.matchUrl(index, 'https://www.facebook.com/Taoyuan.Info').matches, 'info');
  assert.strictEqual(flagged.alerts.length, 1);
  assert.strictEqual(flagged.cleared.length, 0);

  const cleared = SMA.splitMatches(SMA.matchUrl(index, 'https://www.facebook.com/i.Taoyuan').matches, 'info');
  assert.strictEqual(cleared.alerts.length, 0, '已澄清的帳號不該產生警示');
  assert.strictEqual(cleared.cleared.length, 1);
});

test('最低顯示等級不會影響已澄清項目', () => {
  const matches = [
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'a', level: 'info' }),
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'b', level: 'safe' })
  ];
  const split = SMA.splitMatches(matches, 'danger');
  assert.strictEqual(split.alerts.length, 0, 'info 應被最低等級濾掉');
  assert.strictEqual(split.cleared.length, 1, 'safe 不受最低等級影響');
});

test('mergeMatches 以網址代號的結果優先且不重複', () => {
  const byKey = [{ id: 'x', level: 'warning' }];
  const byName = [{ id: 'x', level: 'warning', _viaName: true }, { id: 'y', level: 'danger', _viaName: true }];
  const merged = SMA.mergeMatches(byKey, byName);
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged[0].id, 'y');
  assert.strictEqual(merged.find((m) => m.id === 'x')._viaName, undefined);
});

test('內建與訂閱清單是同一份資料時不會重複警示', () => {
  const builtin = SMA.normalizeEntryInput({
    platform: 'facebook', handle: 'same.page', level: 'warning',
    reason: '相同的依據', source: 'builtin'
  });
  // 訂閱來的同一筆：內容一樣，只有 id 與 source 不同
  const subscribed = SMA.normalizeEntryInput({
    platform: 'facebook', handle: 'same.page', level: 'warning',
    reason: '相同的依據', source: 'subscription:https://example.com/list.json'
  });
  const index = SMA.buildIndex([builtin, subscribed]);

  const result = SMA.matchUrl(index, 'https://www.facebook.com/same.page');
  assert.strictEqual(result.matches.length, 1, '同內容的重複項目應只顯示一筆');
});

test('理由不同的兩筆標記都會保留', () => {
  const index = SMA.buildIndex([
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'same.page', level: 'warning', reason: '依據 A' }),
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'same.page', level: 'warning', reason: '依據 B' })
  ]);
  const result = SMA.matchUrl(index, 'https://www.facebook.com/same.page');
  assert.strictEqual(result.matches.length, 2, '不同依據視為不同標記，應全部保留');
});

test('去重後仍以最高等級排在最前面', () => {
  const index = SMA.buildIndex([
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'dup2', level: 'info', reason: '低' }),
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'dup2', level: 'info', reason: '低' }),
    SMA.normalizeEntryInput({ platform: 'facebook', handle: 'dup2', level: 'danger', reason: '高' })
  ]);
  const result = SMA.matchUrl(index, 'https://www.facebook.com/dup2');
  assert.strictEqual(result.matches.length, 2);
  assert.strictEqual(result.matches[0].level, 'danger');
});

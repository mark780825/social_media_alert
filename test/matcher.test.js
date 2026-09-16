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

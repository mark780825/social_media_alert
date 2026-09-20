/**
 * 共用比對邏輯：把網址解析成「平台 + 帳號識別碼」，再跟警示清單比對。
 * 這個檔案同時被 content script、popup、options 與 service worker 載入，
 * 因此寫成傳統 script（掛在全域 SMA 命名空間），不使用 ES module 語法。
 */
(function (root) {
  'use strict';

  const PLATFORM = {
    FACEBOOK: 'facebook',
    THREADS: 'threads',
    ANY: 'any'
  };

  const LEVELS = {
    danger: { key: 'danger', label: '高風險', weight: 3 },
    warning: { key: 'warning', label: '需留意', weight: 2 },
    info: { key: 'info', label: '提醒', weight: 1 },
    // safe 代表「已查核、與被點名的對象無關」，用來避免同名粉專被誤認，不會發出警示。
    safe: { key: 'safe', label: '已澄清', weight: 0 }
  };

  // Facebook 路徑第一段若落在這些保留字，就不是個人／粉專帳號。
  const FB_RESERVED_PATHS = new Set([
    'watch', 'groups', 'group', 'marketplace', 'gaming', 'events', 'event',
    'photo', 'photos', 'video', 'videos', 'reel', 'reels', 'stories', 'story.php',
    'permalink.php', 'sharer', 'sharer.php', 'share', 'hashtag', 'search',
    'settings', 'messages', 'notifications', 'bookmarks', 'friends', 'saved',
    'help', 'policies', 'privacy', 'legal', 'login', 'logout', 'recover',
    'checkpoint', 'ajax', 'dialog', 'plugins', 'l.php', 'flx', 'business',
    'ads', 'adsmanager', 'home.php', 'me', 'games', 'fundraisers', 'memories',
    'weather', 'live', 'lite', 'directory', 'pages_feed', 'latest', 'find-friends'
  ]);

  const THREADS_RESERVED_PATHS = new Set([
    'search', 'activity', 'settings', 'login', 'signup', 'explore', 'about',
    'privacy', 'terms', 'download', 'api', 'accounts', 'direct'
  ]);

  function isFacebookHost(host) {
    return /(^|\.)(facebook\.com|fb\.com|m\.facebook\.com)$/i.test(host);
  }

  function isThreadsHost(host) {
    return /(^|\.)(threads\.net|threads\.com)$/i.test(host);
  }

  function platformFromHost(host) {
    if (!host) return null;
    if (isFacebookHost(host)) return PLATFORM.FACEBOOK;
    if (isThreadsHost(host)) return PLATFORM.THREADS;
    return null;
  }

  /** 正規化帳號名稱：去掉 @、空白、尾端斜線，統一小寫。 */
  function normalizeHandle(value) {
    if (!value) return '';
    let handle = String(value).trim();
    try {
      handle = decodeURIComponent(handle);
    } catch (err) {
      // 網址編碼不合法時就用原字串。
    }
    handle = handle.replace(/^@+/, '').replace(/\/+$/, '').trim();
    return handle.toLowerCase();
  }

  /**
   * 粉專顯示名稱正規化：去掉所有空白、統一全形符號與大小寫。
   * 用於清冊裡只留下名稱、查不到網址代號的項目。
   */
  function normalizeName(value) {
    if (!value) return '';
    return String(value)
      .replace(/[\s\u3000]+/g, '')
      .replace(/＋/g, '+')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .replace(/[：]/g, ':')
      .replace(/[／]/g, '/')
      .toLowerCase();
  }

  function normalizeProfileId(value) {
    if (!value) return '';
    const digits = String(value).replace(/\D/g, '');
    return digits;
  }

  function toUrl(input) {
    if (!input) return null;
    try {
      if (input instanceof URL) return input;
      // 支援相對路徑（feed 內的連結常是 /somepage）
      const base = root.location && root.location.href ? root.location.href : 'https://www.facebook.com/';
      return new URL(String(input), base);
    } catch (err) {
      return null;
    }
  }

  /**
   * 解析 Facebook 網址中的帳號。
   * 支援 /pagename、/profile.php?id=、/people/Name/123、/pages/Name/123、/pagename/posts/...
   */
  function parseFacebookUrl(url) {
    const segments = url.pathname.split('/').filter(Boolean);
    const first = (segments[0] || '').toLowerCase();

    if (first === 'profile.php' || url.searchParams.has('id')) {
      const profileId = normalizeProfileId(url.searchParams.get('id'));
      if (profileId) {
        return { platform: PLATFORM.FACEBOOK, kind: 'id', value: profileId, url: url.href };
      }
    }

    if ((first === 'people' || first === 'pages') && segments.length >= 3) {
      const profileId = normalizeProfileId(segments[segments.length - 1]);
      if (profileId) {
        return { platform: PLATFORM.FACEBOOK, kind: 'id', value: profileId, url: url.href };
      }
    }

    if (first === 'groups' && segments[1]) {
      return {
        platform: PLATFORM.FACEBOOK,
        kind: 'group',
        value: normalizeHandle(segments[1]),
        url: url.href
      };
    }

    if (!first || FB_RESERVED_PATHS.has(first)) return null;
    if (first.endsWith('.php')) return null;

    const handle = normalizeHandle(segments[0]);
    if (!handle || handle.length < 2) return null;
    return { platform: PLATFORM.FACEBOOK, kind: 'handle', value: handle, url: url.href };
  }

  /** 解析 Threads 網址中的帳號，例如 /@someone 或 /@someone/post/xxx。 */
  function parseThreadsUrl(url) {
    const segments = url.pathname.split('/').filter(Boolean);
    let first = segments[0] || '';
    if (!first) return null;

    if (first.startsWith('@')) {
      const handle = normalizeHandle(first);
      if (!handle) return null;
      return { platform: PLATFORM.THREADS, kind: 'handle', value: handle, url: url.href };
    }

    const lowered = first.toLowerCase();
    if (THREADS_RESERVED_PATHS.has(lowered)) return null;
    return null;
  }

  /** 從任意網址解析出帳號目標；不是社群帳號頁就回傳 null。 */
  function parseProfileTarget(input) {
    const url = toUrl(input);
    if (!url) return null;

    // Facebook 的外連跳轉：/l.php?u=<encoded>
    if (isFacebookHost(url.hostname) && url.pathname === '/l.php' && url.searchParams.has('u')) {
      return parseProfileTarget(url.searchParams.get('u'));
    }

    const platform = platformFromHost(url.hostname);
    if (platform === PLATFORM.FACEBOOK) return parseFacebookUrl(url);
    if (platform === PLATFORM.THREADS) return parseThreadsUrl(url);
    return null;
  }

  function entryKeys(entry) {
    const keys = [];
    const platform = entry.platform || PLATFORM.ANY;
    const handle = normalizeHandle(entry.handle);
    const profileId = normalizeProfileId(entry.profileId);
    if (handle) {
      keys.push(platform + '|handle|' + handle);
      if (platform === PLATFORM.ANY) {
        keys.push(PLATFORM.FACEBOOK + '|handle|' + handle);
        keys.push(PLATFORM.THREADS + '|handle|' + handle);
      }
    }
    if (profileId) {
      keys.push(platform + '|id|' + profileId);
      if (platform === PLATFORM.ANY) {
        keys.push(PLATFORM.FACEBOOK + '|id|' + profileId);
      }
    }
    if (entry.groupId) {
      keys.push(PLATFORM.FACEBOOK + '|group|' + normalizeHandle(entry.groupId));
    }
    return keys;
  }

  function pushBucket(map, key, entry) {
    const bucket = map.get(key);
    if (bucket) bucket.push(entry);
    else map.set(key, [entry]);
  }

  /**
   * 把清單整理成查表結構，避免每次比對都線性掃描。
   * keys：以平台＋網址代號查詢；names：以粉專顯示名稱查詢。
   */
  function buildIndex(entries) {
    const keys = new Map();
    const names = new Map();
    let size = 0;

    (entries || []).forEach(function (entry) {
      if (!entry) return;
      size += 1;
      entryKeys(entry).forEach(function (key) {
        pushBucket(keys, key, entry);
      });
      (entry.nameMatch || []).forEach(function (name) {
        const normalized = normalizeName(name);
        if (normalized) pushBucket(names, normalized, entry);
      });
    });

    return { keys: keys, names: names, size: size };
  }

  /** 相容舊呼叫：buildIndex 以前直接回傳 Map。 */
  function keyMap(index) {
    if (!index) return new Map();
    if (index instanceof Map) return index;
    return index.keys || new Map();
  }

  /**
   * 去除內容完全相同的重複項目。
   * 常見情境：使用者訂閱的清單與內建清單是同一份資料，
   * 兩邊都會命中，若不處理就會在警示卡上顯示「另外還有 N 筆」。
   * 理由不同的項目視為不同標記，會全部保留。
   */
  function dedupe(entries) {
    const seen = new Set();
    return (entries || []).filter(function (entry) {
      const key = [entry.platform, entry.handle, entry.profileId, entry.groupId,
        entry.level, entry.reason].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function levelWeight(level) {
    const info = LEVELS[level];
    return info ? info.weight : 0;
  }

  /** 以解析出的目標查詢清單，回傳命中的項目（嚴重度高的排前面）。 */
  function matchTarget(index, target) {
    if (!index || !target || !target.value) return [];
    const map = keyMap(index);
    const key = target.platform + '|' + target.kind + '|' + target.value;
    const hits = map.get(key) || [];
    const anyKey = PLATFORM.ANY + '|' + target.kind + '|' + target.value;
    const anyHits = map.get(anyKey) || [];
    const merged = hits.concat(anyHits.filter(function (entry) {
      return hits.indexOf(entry) === -1;
    }));
    return dedupe(merged).sort(function (a, b) {
      return levelWeight(b.level) - levelWeight(a.level);
    });
  }

  /** 直接用網址查詢，content script 掃描貼文連結時使用。 */
  function matchUrl(index, url) {
    const target = parseProfileTarget(url);
    if (!target) return { target: null, matches: [] };
    return { target: target, matches: matchTarget(index, target) };
  }

  /**
   * 以粉專顯示名稱比對清單。命中的項目會複製一份並標上 _viaName，
   * 讓介面能提醒使用者「這是用名稱比對的，請自行確認是不是同一個粉專」。
   */
  function matchNames(index, candidates) {
    if (!index || !index.names || !candidates || !candidates.length) return [];
    const seen = new Set();
    const results = [];

    candidates.forEach(function (candidate) {
      const normalized = normalizeName(candidate);
      if (!normalized) return;
      (index.names.get(normalized) || []).forEach(function (entry) {
        if (seen.has(entry.id)) return;
        seen.add(entry.id);
        results.push(Object.assign({}, entry, { _viaName: true }));
      });
    });

    return dedupe(results).sort(function (a, b) {
      return levelWeight(b.level) - levelWeight(a.level);
    });
  }

  /** 合併網址代號與名稱兩種命中結果，網址代號的結果優先。 */
  function mergeMatches(keyMatches, nameMatches) {
    const ids = new Set((keyMatches || []).map(function (entry) { return entry.id; }));
    const extra = (nameMatches || []).filter(function (entry) { return !ids.has(entry.id); });
    return dedupe((keyMatches || []).concat(extra)).sort(function (a, b) {
      return levelWeight(b.level) - levelWeight(a.level);
    });
  }

  /** 把命中結果拆成「要警示的」與「已澄清的」。 */
  function splitMatches(matches, minLevel) {
    const floor = levelWeight(minLevel || 'info');
    const alerts = [];
    const cleared = [];
    (matches || []).forEach(function (entry) {
      if (entry.level === 'safe') cleared.push(entry);
      else if (levelWeight(entry.level) >= floor) alerts.push(entry);
    });
    return { alerts: alerts, cleared: cleared };
  }

  function highestLevel(matches) {
    let best = null;
    (matches || []).forEach(function (entry) {
      if (!best || levelWeight(entry.level) > levelWeight(best)) {
        best = entry.level;
      }
    });
    return best;
  }

  function createId() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') {
      return root.crypto.randomUUID();
    }
    return 'e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** 使用者輸入的帳號或網址 → 標準化的清單項目欄位。 */
  function normalizeEntryInput(raw) {
    const entry = Object.assign({}, raw);
    entry.platform = entry.platform || PLATFORM.ANY;
    entry.level = LEVELS[entry.level] ? entry.level : 'warning';

    if (entry.url && !entry.handle && !entry.profileId) {
      const target = parseProfileTarget(entry.url);
      if (target) {
        entry.platform = target.platform;
        if (target.kind === 'id') entry.profileId = target.value;
        else if (target.kind === 'group') entry.groupId = target.value;
        else entry.handle = target.value;
      }
    }

    if (entry.handle && /^https?:\/\//i.test(entry.handle)) {
      const target = parseProfileTarget(entry.handle);
      if (target) {
        entry.platform = target.platform;
        entry.url = entry.url || entry.handle;
        entry.handle = target.kind === 'handle' ? target.value : '';
        if (target.kind === 'id') entry.profileId = target.value;
        if (target.kind === 'group') entry.groupId = target.value;
      }
    }

    entry.handle = normalizeHandle(entry.handle);
    entry.profileId = normalizeProfileId(entry.profileId);
    entry.name = (entry.name || '').trim();
    entry.reason = (entry.reason || '').trim();
    if (Array.isArray(entry.nameMatch)) {
      entry.nameMatch = entry.nameMatch.map(function (n) { return String(n).trim(); }).filter(Boolean);
    } else if (entry.nameMatch) {
      entry.nameMatch = [String(entry.nameMatch).trim()].filter(Boolean);
    } else {
      entry.nameMatch = [];
    }
    entry.tags = Array.isArray(entry.tags)
      ? entry.tags.map(function (t) { return String(t).trim(); }).filter(Boolean)
      : [];
    entry.id = entry.id || createId();
    entry.source = entry.source || 'user';
    entry.addedAt = entry.addedAt || new Date().toISOString();
    return entry;
  }

  function isValidEntry(entry) {
    if (!entry) return false;
    return Boolean(entry.handle || entry.profileId || entry.groupId
      || (entry.nameMatch && entry.nameMatch.length));
  }

  function describeTarget(target) {
    if (!target) return '';
    if (target.kind === 'id') return 'ID ' + target.value;
    if (target.kind === 'group') return '社團 ' + target.value;
    return '@' + target.value;
  }

  const api = {
    PLATFORM: PLATFORM,
    LEVELS: LEVELS,
    normalizeHandle: normalizeHandle,
    normalizeName: normalizeName,
    normalizeProfileId: normalizeProfileId,
    platformFromHost: platformFromHost,
    parseProfileTarget: parseProfileTarget,
    buildIndex: buildIndex,
    matchTarget: matchTarget,
    matchNames: matchNames,
    dedupe: dedupe,
    mergeMatches: mergeMatches,
    splitMatches: splitMatches,
    matchUrl: matchUrl,
    highestLevel: highestLevel,
    levelWeight: levelWeight,
    normalizeEntryInput: normalizeEntryInput,
    isValidEntry: isValidEntry,
    describeTarget: describeTarget,
    createId: createId
  };

  root.SMA = Object.assign(root.SMA || {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : self);

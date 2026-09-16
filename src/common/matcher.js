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
    info: { key: 'info', label: '提醒', weight: 1 }
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

  /** 把清單整理成查表用的 Map，避免每次比對都線性掃描。 */
  function buildIndex(entries) {
    const index = new Map();
    (entries || []).forEach(function (entry) {
      if (!entry) return;
      entryKeys(entry).forEach(function (key) {
        const bucket = index.get(key);
        if (bucket) {
          bucket.push(entry);
        } else {
          index.set(key, [entry]);
        }
      });
    });
    return index;
  }

  function levelWeight(level) {
    const info = LEVELS[level];
    return info ? info.weight : 0;
  }

  /** 以解析出的目標查詢清單，回傳命中的項目（嚴重度高的排前面）。 */
  function matchTarget(index, target) {
    if (!index || !target || !target.value) return [];
    const key = target.platform + '|' + target.kind + '|' + target.value;
    const hits = index.get(key) || [];
    const anyKey = PLATFORM.ANY + '|' + target.kind + '|' + target.value;
    const anyHits = index.get(anyKey) || [];
    const merged = hits.concat(anyHits.filter(function (entry) {
      return hits.indexOf(entry) === -1;
    }));
    return merged.slice().sort(function (a, b) {
      return levelWeight(b.level) - levelWeight(a.level);
    });
  }

  /** 直接用網址查詢，content script 掃描貼文連結時使用。 */
  function matchUrl(index, url) {
    const target = parseProfileTarget(url);
    if (!target) return { target: null, matches: [] };
    return { target: target, matches: matchTarget(index, target) };
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
    entry.tags = Array.isArray(entry.tags)
      ? entry.tags.map(function (t) { return String(t).trim(); }).filter(Boolean)
      : [];
    entry.id = entry.id || createId();
    entry.source = entry.source || 'user';
    entry.addedAt = entry.addedAt || new Date().toISOString();
    return entry;
  }

  function isValidEntry(entry) {
    return Boolean(entry && (entry.handle || entry.profileId || entry.groupId));
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
    normalizeProfileId: normalizeProfileId,
    platformFromHost: platformFromHost,
    parseProfileTarget: parseProfileTarget,
    buildIndex: buildIndex,
    matchTarget: matchTarget,
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

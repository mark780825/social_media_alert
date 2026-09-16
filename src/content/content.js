/**
 * Content script：在 Facebook / Threads 頁面上比對警示清單，
 * 命中時於頁面頂端顯示警示橫幅，並在動態牆的貼文上加註標記。
 */
(function () {
  'use strict';

  const SMA = window.SMA;
  if (!SMA || !SMA.storage) return;

  const HOST_ID = 'sma-alert-banner-host';
  const PROCESSED_ATTR = 'data-sma-checked';
  const FLAG_ATTR = 'data-sma-flagged';
  const MAX_LINKS_PER_PASS = 400;

  const state = {
    settings: Object.assign({}, SMA.DEFAULT_SETTINGS),
    index: new Map(),
    entryCount: 0,
    lastUrl: location.href,
    currentTarget: null,
    currentMatches: [],
    dismissedKeys: new Set(),
    scanScheduled: false,
    ready: false,
    pendingAlerts: 0,
    lastStatsFlush: 0
  };

  const STATS_FLUSH_INTERVAL = 3000;

  const POST_SELECTORS = [
    '[role="article"]',
    '[data-pagelet^="FeedUnit"]',
    '[data-ad-preview="message"]',
    'article'
  ];

  /** 累積提醒次數，每隔一段時間才寫回 storage。 */
  function reportAlerts(count) {
    if (!count) return;
    state.pendingAlerts += count;
    const now = Date.now();
    if (now - state.lastStatsFlush < STATS_FLUSH_INTERVAL) return;
    state.lastStatsFlush = now;
    const pending = state.pendingAlerts;
    state.pendingAlerts = 0;
    SMA.storage.bumpAlertCount(pending);
  }

  function sendMessage(message) {
    try {
      chrome.runtime.sendMessage(message, function () {
        // 背景服務可能尚未啟動，忽略沒有接收者的錯誤。
        void chrome.runtime.lastError;
      });
    } catch (err) {
      // 擴充功能重新載入後 context 會失效，忽略即可。
    }
  }

  function levelLabel(level) {
    const info = SMA.LEVELS[level];
    return info ? info.label : '提醒';
  }

  function meetsMinLevel(entry) {
    return SMA.levelWeight(entry.level) >= SMA.levelWeight(state.settings.minLevel || 'info');
  }

  function filterMatches(matches) {
    return (matches || []).filter(meetsMinLevel);
  }

  function targetKey(target) {
    return target ? target.platform + '|' + target.kind + '|' + target.value : '';
  }

  // ---------------------------------------------------------------- 資料載入

  async function loadData() {
    const [settings, entries] = await Promise.all([
      SMA.storage.getSettings(),
      SMA.storage.getAllEntries()
    ]);
    state.settings = settings;
    state.entryCount = entries.length;
    state.index = SMA.buildIndex(entries);
    state.ready = true;
  }

  // ---------------------------------------------------------------- 頁面橫幅

  const BANNER_STYLE = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      width: min(640px, calc(100vw - 24px));
      font-family: -apple-system, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
      color: #1b1b1b;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, .28);
      overflow: hidden;
      animation: drop .18s ease-out;
    }
    @keyframes drop { from { opacity: 0; transform: translate(-50%, -12px); } }
    .bar { height: 6px; background: #d93025; }
    .bar.warning { background: #f29900; }
    .bar.info { background: #1a73e8; }
    .body { padding: 14px 16px 12px; }
    .head { display: flex; align-items: center; gap: 8px; }
    .tag {
      font-size: 12px; font-weight: 700; color: #fff; background: #d93025;
      border-radius: 999px; padding: 3px 10px;
    }
    .tag.warning { background: #b06000; }
    .tag.info { background: #1a73e8; }
    .title { font-size: 15px; font-weight: 700; flex: 1; }
    .close {
      border: none; background: transparent; font-size: 18px; line-height: 1;
      cursor: pointer; color: #5f6368; padding: 4px 6px; border-radius: 6px;
    }
    .close:hover { background: #f1f3f4; }
    .handle { font-size: 13px; color: #5f6368; margin-top: 4px; word-break: break-all; }
    .reason { font-size: 14px; margin-top: 8px; line-height: 1.5; white-space: pre-wrap; }
    .tags { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      font-size: 12px; background: #f1f3f4; color: #3c4043;
      border-radius: 999px; padding: 2px 8px;
    }
    .meta { font-size: 12px; color: #80868b; margin-top: 8px; }
    .actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    button.action {
      font-size: 13px; border-radius: 8px; padding: 7px 12px; cursor: pointer;
      border: 1px solid #dadce0; background: #fff; color: #3c4043;
    }
    button.action:hover { background: #f8f9fa; }
    button.action.primary { background: #d93025; border-color: #d93025; color: #fff; }
    button.action.primary:hover { background: #b7261d; }
    .more { border-top: 1px solid #e8eaed; margin-top: 10px; padding-top: 8px; font-size: 13px; color: #5f6368; }
  `;

  function removeBanner() {
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
  }

  function showBanner(target, matches) {
    removeBanner();
    if (!matches.length) return;

    const top = matches[0];
    const level = SMA.highestLevel(matches) || 'warning';
    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = BANNER_STYLE;

    const wrap = document.createElement('div');
    wrap.className = 'wrap';

    const bar = document.createElement('div');
    bar.className = 'bar ' + level;

    const body = document.createElement('div');
    body.className = 'body';

    const head = document.createElement('div');
    head.className = 'head';

    const tag = document.createElement('span');
    tag.className = 'tag ' + level;
    tag.textContent = '⚠ ' + levelLabel(level);

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = top.name || SMA.describeTarget(target);

    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.textContent = '✕';
    close.title = '關閉警示';
    close.addEventListener('click', function () {
      state.dismissedKeys.add(targetKey(target));
      removeBanner();
    });

    head.append(tag, title, close);

    const handle = document.createElement('div');
    handle.className = 'handle';
    handle.textContent = '你正在瀏覽的帳號：' + SMA.describeTarget(target);

    const reason = document.createElement('div');
    reason.className = 'reason';
    reason.textContent = top.reason || '這個帳號被列在你的警示清單中，請謹慎判斷內容真偽。';

    body.append(head, handle, reason);

    if (top.tags && top.tags.length) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      top.tags.forEach(function (name) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = name;
        tags.appendChild(chip);
      });
      body.appendChild(tags);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = '來源：' + sourceLabel(top.source);
    body.appendChild(meta);

    if (matches.length > 1) {
      const more = document.createElement('div');
      more.className = 'more';
      more.textContent = '另外還有 ' + (matches.length - 1) + ' 筆標記符合這個帳號。';
      body.appendChild(more);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';

    const ok = document.createElement('button');
    ok.className = 'action primary';
    ok.type = 'button';
    ok.textContent = '我知道了';
    ok.addEventListener('click', function () {
      state.dismissedKeys.add(targetKey(target));
      removeBanner();
    });

    const manage = document.createElement('button');
    manage.className = 'action';
    manage.type = 'button';
    manage.textContent = '管理警示清單';
    manage.addEventListener('click', function () {
      sendMessage({ type: 'OPEN_OPTIONS' });
    });

    actions.append(ok, manage);
    body.appendChild(actions);

    wrap.append(bar, body);
    shadow.append(style, wrap);
    (document.body || document.documentElement).appendChild(host);

    reportAlerts(1);
  }

  function sourceLabel(source) {
    if (!source || source === 'user') return '自行新增';
    if (source === 'builtin') return '內建示範清單';
    if (String(source).indexOf('subscription') === 0) return '訂閱清單';
    return String(source);
  }

  // ---------------------------------------------------------------- 目前頁面

  function evaluateCurrentPage() {
    const result = SMA.matchUrl(state.index, location.href);
    const matches = filterMatches(result.matches);
    state.currentTarget = result.target;
    state.currentMatches = matches;

    sendMessage({
      type: 'PAGE_STATUS_CHANGED',
      payload: {
        url: location.href,
        target: result.target,
        matchCount: matches.length,
        level: SMA.highestLevel(matches)
      }
    });

    if (!state.settings.enabled || !state.settings.showPageBanner) {
      removeBanner();
      return;
    }
    if (!matches.length || state.dismissedKeys.has(targetKey(result.target))) {
      removeBanner();
      return;
    }
    showBanner(result.target, matches);
  }

  // ---------------------------------------------------------------- 貼文標記

  function findPostContainer(link) {
    for (let i = 0; i < POST_SELECTORS.length; i += 1) {
      const container = link.closest(POST_SELECTORS[i]);
      if (container) return container;
    }
    return null;
  }

  function buildPostWarning(matches) {
    const top = matches[0];
    const level = SMA.highestLevel(matches) || 'warning';
    const box = document.createElement('div');
    box.className = 'sma-post-warning sma-level-' + level;
    box.setAttribute('role', 'note');

    const icon = document.createElement('span');
    icon.className = 'sma-post-warning__icon';
    icon.textContent = '⚠';

    const text = document.createElement('div');
    text.className = 'sma-post-warning__text';

    const title = document.createElement('div');
    title.className = 'sma-post-warning__title';
    title.textContent = levelLabel(level) + '：' + (top.name || '此帳號在你的警示清單中');

    text.appendChild(title);

    if (top.reason) {
      const desc = document.createElement('div');
      desc.className = 'sma-post-warning__desc';
      desc.textContent = top.reason;
      text.appendChild(desc);
    }

    box.append(icon, text);
    return box;
  }

  function markLink(link, matches) {
    const level = SMA.highestLevel(matches) || 'warning';
    link.classList.add('sma-flagged-link', 'sma-level-' + level);
    const top = matches[0];
    link.title = '⚠ ' + levelLabel(level) + '：' + (top.reason || top.name || '此帳號在警示清單中');

    const container = findPostContainer(link);
    if (!container) return;
    if (container.getAttribute(FLAG_ATTR) === '1') return;
    container.setAttribute(FLAG_ATTR, '1');
    if (state.settings.dimFlaggedPosts) {
      container.classList.add('sma-flagged-post', 'sma-level-' + level);
    }
    container.insertBefore(buildPostWarning(matches), container.firstChild);
  }

  function scanLinks() {
    if (!state.ready || !state.settings.enabled || !state.settings.showFeedBadges) return;
    if (!state.index.size) return;

    const links = document.querySelectorAll('a[href]:not([' + PROCESSED_ATTR + '])');
    const limit = Math.min(links.length, MAX_LINKS_PER_PASS);
    let flagged = 0;

    for (let i = 0; i < limit; i += 1) {
      const link = links[i];
      link.setAttribute(PROCESSED_ATTR, '1');
      const href = link.getAttribute('href');
      if (!href || href.charAt(0) === '#' || href.indexOf('javascript:') === 0) continue;

      const result = SMA.matchUrl(state.index, href);
      const matches = filterMatches(result.matches);
      if (!matches.length) continue;

      markLink(link, matches);
      flagged += 1;
    }

    reportAlerts(flagged);
  }

  function clearMarks() {
    document.querySelectorAll('[' + PROCESSED_ATTR + ']').forEach(function (el) {
      el.removeAttribute(PROCESSED_ATTR);
    });
    document.querySelectorAll('.sma-post-warning').forEach(function (el) { el.remove(); });
    document.querySelectorAll('.sma-flagged-post').forEach(function (el) {
      el.removeAttribute(FLAG_ATTR);
      el.classList.remove('sma-flagged-post', 'sma-level-danger', 'sma-level-warning', 'sma-level-info');
    });
    document.querySelectorAll('.sma-flagged-link').forEach(function (el) {
      el.classList.remove('sma-flagged-link', 'sma-level-danger', 'sma-level-warning', 'sma-level-info');
      el.removeAttribute('title');
    });
  }

  // ---------------------------------------------------------------- 排程

  function scheduleScan() {
    if (state.scanScheduled) return;
    state.scanScheduled = true;
    const run = function () {
      state.scanScheduled = false;
      try {
        scanLinks();
      } catch (err) {
        console.warn('[social-media-alert] 掃描失敗', err);
      }
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 800 });
    } else {
      setTimeout(run, 300);
    }
  }

  function handleUrlChange() {
    if (location.href === state.lastUrl) return;
    state.lastUrl = location.href;
    removeBanner();
    evaluateCurrentPage();
    scheduleScan();
  }

  function observeDom() {
    const observer = new MutationObserver(function () {
      scheduleScan();
      handleUrlChange();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function observeNavigation() {
    ['pushState', 'replaceState'].forEach(function (method) {
      const original = history[method];
      if (typeof original !== 'function') return;
      history[method] = function () {
        const result = original.apply(this, arguments);
        setTimeout(handleUrlChange, 0);
        return result;
      };
    });
    window.addEventListener('popstate', handleUrlChange);
    setInterval(handleUrlChange, 1500);
  }

  // ---------------------------------------------------------------- 訊息

  function registerMessageHandler() {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || !message.type) return undefined;

      if (message.type === 'GET_PAGE_STATUS') {
        sendResponse({
          url: location.href,
          target: state.currentTarget,
          matches: state.currentMatches,
          entryCount: state.entryCount,
          settings: state.settings
        });
        return true;
      }

      if (message.type === 'RESCAN') {
        refresh();
        sendResponse({ ok: true });
        return true;
      }

      return undefined;
    });
  }

  async function refresh() {
    await loadData();
    clearMarks();
    evaluateCurrentPage();
    scheduleScan();
  }

  async function init() {
    await loadData();
    SMA.storage.onChanged(function (changes) {
      if (changes.entries || changes.subscription || changes.settings) {
        refresh();
      }
    });
    registerMessageHandler();
    evaluateCurrentPage();
    scheduleScan();
    observeDom();
    observeNavigation();
  }

  init().catch(function (err) {
    console.warn('[social-media-alert] 初始化失敗', err);
  });
})();

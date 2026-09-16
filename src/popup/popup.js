/** Popup：顯示目前分頁的帳號狀態，並提供快速加入／移除警示清單。 */
(function () {
  'use strict';

  const SMA = window.SMA;
  const el = {
    toggle: document.getElementById('toggle-enabled'),
    target: document.getElementById('status-target'),
    result: document.getElementById('status-result'),
    matches: document.getElementById('status-matches'),
    addCard: document.getElementById('add-card'),
    addName: document.getElementById('add-name'),
    addLevel: document.getElementById('add-level'),
    addReason: document.getElementById('add-reason'),
    addSubmit: document.getElementById('add-submit'),
    addHint: document.getElementById('add-hint'),
    statEntries: document.getElementById('stat-entries'),
    statAlerts: document.getElementById('stat-alerts'),
    openOptions: document.getElementById('open-options')
  };

  let currentTarget = null;
  let currentTabId = null;
  let currentSettings = null;

  function setHint(message, type) {
    el.addHint.textContent = message || '';
    el.addHint.className = 'hint' + (type ? ' hint--' + type : '');
  }

  function queryActiveTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs && tabs[0] ? tabs[0] : null);
      });
    });
  }

  function askContentScript(tabId) {
    return new Promise(function (resolve) {
      chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_STATUS' }, function (response) {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response);
      });
    });
  }

  function renderMatch(entry) {
    const box = document.createElement('div');
    box.className = 'match';

    const head = document.createElement('div');
    head.className = 'match__head';

    const name = document.createElement('span');
    name.className = 'match__name';
    name.textContent = entry.name || (entry.handle ? '@' + entry.handle : entry.profileId);

    head.appendChild(name);

    if (entry.source === 'user' || !entry.source) {
      const remove = document.createElement('button');
      remove.className = 'btn btn--link';
      remove.type = 'button';
      remove.textContent = '移除';
      remove.addEventListener('click', async function () {
        await SMA.storage.removeEntry(entry.id);
        await refresh();
      });
      head.appendChild(remove);
    }

    box.appendChild(head);

    if (entry.reason) {
      const reason = document.createElement('div');
      reason.className = 'match__reason';
      reason.textContent = entry.reason;
      box.appendChild(reason);
    }

    const meta = document.createElement('div');
    meta.className = 'match__meta';
    const levelInfo = SMA.LEVELS[entry.level];
    const source = entry.source === 'builtin' ? '內建清單'
      : entry.source && entry.source.indexOf('subscription') === 0 ? '訂閱清單' : '自行新增';
    meta.textContent = (levelInfo ? levelInfo.label : '提醒') + '・來源：' + source
      + (entry._viaName ? '・以名稱比對' : '');
    box.appendChild(meta);

    if (entry._viaName) {
      const note = document.createElement('div');
      note.className = 'match__note';
      note.textContent = '清單裡沒有這筆的網址代號，是用粉專名稱比對的，請自行確認是不是同一個粉專。';
      box.appendChild(note);
    }

    return box;
  }

  function renderStatus(status) {
    el.matches.textContent = '';
    el.result.className = 'status';

    if (!status || !status.target) {
      el.target.textContent = status ? '這個頁面不是帳號或粉專頁' : '此分頁不支援（僅支援 Facebook / Threads）';
      el.result.classList.add('status--none');
      el.result.textContent = status
        ? '打開某個粉專或帳號頁面後，就能在這裡把它加入警示清單。'
        : '請在 Facebook 或 Threads 分頁中開啟本擴充功能。';
      el.addCard.hidden = true;
      currentTarget = null;
      return;
    }

    currentTarget = status.target;
    el.target.textContent = SMA.describeTarget(status.target)
      + '（' + (status.target.platform === 'facebook' ? 'Facebook' : 'Threads') + '）';

    const settings = status.settings || currentSettings || SMA.DEFAULT_SETTINGS;
    const split = SMA.splitMatches(status.matches || [], settings.minLevel);

    if (split.alerts.length) {
      const level = SMA.highestLevel(split.alerts) || 'warning';
      el.result.classList.add('status--' + level);
      el.result.textContent = '⚠ 這個帳號被標記為「'
        + (SMA.LEVELS[level] ? SMA.LEVELS[level].label : '提醒') + '」，共 '
        + split.alerts.length + ' 筆紀錄。';
      split.alerts.forEach(function (entry) {
        el.matches.appendChild(renderMatch(entry));
      });
      el.addCard.hidden = true;
      return;
    }

    if (split.cleared.length) {
      el.result.classList.add('status--safe');
      el.result.textContent = '✔ 已澄清：這個帳號被標註為與被點名的對象無關。';
      split.cleared.forEach(function (entry) {
        el.matches.appendChild(renderMatch(entry));
      });
      el.addCard.hidden = false;
      setHint('');
      return;
    }

    el.result.classList.add('status--safe');
    el.result.textContent = '✔ 這個帳號目前不在你的警示清單中。';
    el.addCard.hidden = false;
    setHint('');
  }

  async function refresh() {
    const [settings, entries, stats] = await Promise.all([
      SMA.storage.getSettings(),
      SMA.storage.getAllEntries(),
      SMA.storage.getStats()
    ]);

    currentSettings = settings;
    el.toggle.checked = settings.enabled;
    el.statEntries.textContent = String(entries.length);
    el.statAlerts.textContent = String(stats.alertsShown);

    const tab = await queryActiveTab();
    currentTabId = tab ? tab.id : null;

    let status = null;
    if (tab && tab.id != null) {
      status = await askContentScript(tab.id);
      if (!status && tab.url) {
        // content script 尚未注入時，直接用網址解析一次。
        const target = SMA.parseProfileTarget(tab.url);
        if (target) {
          const index = SMA.buildIndex(entries);
          status = { target: target, matches: SMA.matchTarget(index, target) };
        }
      }
    }
    renderStatus(status);
  }

  el.toggle.addEventListener('change', async function () {
    await SMA.storage.saveSettings({ enabled: el.toggle.checked });
    if (currentTabId != null) {
      chrome.tabs.sendMessage(currentTabId, { type: 'RESCAN' }, function () {
        void chrome.runtime.lastError;
      });
    }
  });

  el.addSubmit.addEventListener('click', async function () {
    if (!currentTarget) return;
    const entry = {
      platform: currentTarget.platform,
      name: el.addName.value,
      level: el.addLevel.value,
      reason: el.addReason.value,
      url: currentTarget.url,
      source: 'user'
    };
    if (currentTarget.kind === 'id') entry.profileId = currentTarget.value;
    else if (currentTarget.kind === 'group') entry.groupId = currentTarget.value;
    else entry.handle = currentTarget.value;

    try {
      await SMA.storage.addEntry(entry);
      el.addName.value = '';
      el.addReason.value = '';
      setHint('已加入警示清單', 'ok');
      await refresh();
    } catch (err) {
      setHint(err.message, 'error');
    }
  });

  el.openOptions.addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  refresh();
})();

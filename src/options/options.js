/** 設定頁：管理警示清單、匯入匯出、訂閱來源與顯示選項。 */
(function () {
  'use strict';

  const SMA = window.SMA;
  const $ = function (id) { return document.getElementById(id); };

  const filters = { text: '', platform: '', level: '' };

  function setHint(node, message, type) {
    node.textContent = message || '';
    node.className = 'hint' + (type ? ' hint--' + type : '');
  }

  function platformLabel(platform) {
    if (platform === 'facebook') return 'Facebook';
    if (platform === 'threads') return 'Threads';
    return '不限';
  }

  function sourceLabel(source) {
    if (!source || source === 'user') return '自行新增';
    if (source === 'builtin') return '內建清單';
    if (String(source).indexOf('subscription') === 0) return '訂閱清單';
    return String(source);
  }

  function identityOf(entry) {
    if (entry.handle) return '@' + entry.handle;
    if (entry.profileId) return 'ID ' + entry.profileId;
    if (entry.groupId) return '社團 ' + entry.groupId;
    if (entry.nameMatch && entry.nameMatch.length) return '名稱：' + entry.nameMatch.join('、');
    return '—';
  }

  // ------------------------------------------------------------- 設定區

  async function loadSettings() {
    const settings = await SMA.storage.getSettings();
    $('set-enabled').checked = settings.enabled;
    $('set-banner').checked = settings.showPageBanner;
    $('set-feed').checked = settings.showFeedBadges;
    $('set-dim').checked = settings.dimFlaggedPosts;
    $('set-cleared').checked = settings.showClearedNotice;
    $('set-min-level').value = settings.minLevel;
    $('set-subscription').value = settings.subscriptionUrl || '';
    $('set-auto-update').checked = settings.autoUpdate;
    $('set-interval').value = settings.updateIntervalHours;
  }

  function bindSettings() {
    const save = function () {
      SMA.storage.saveSettings({
        enabled: $('set-enabled').checked,
        showPageBanner: $('set-banner').checked,
        showFeedBadges: $('set-feed').checked,
        dimFlaggedPosts: $('set-dim').checked,
        showClearedNotice: $('set-cleared').checked,
        minLevel: $('set-min-level').value,
        subscriptionUrl: $('set-subscription').value.trim(),
        autoUpdate: $('set-auto-update').checked,
        updateIntervalHours: Math.max(1, Number($('set-interval').value) || 12)
      });
    };

    ['set-enabled', 'set-banner', 'set-feed', 'set-dim', 'set-cleared', 'set-min-level',
      'set-subscription', 'set-auto-update', 'set-interval'].forEach(function (id) {
      $(id).addEventListener('change', save);
    });
  }

  // ------------------------------------------------------------- 訂閱區

  async function renderSubscriptionStatus() {
    const subscription = await SMA.storage.getSubscription();
    const node = $('subscription-status');
    if (subscription.error) {
      setHint(node, '上次更新失敗：' + subscription.error, 'error');
      return;
    }
    if (!subscription.updatedAt) {
      setHint(node, '尚未同步任何訂閱清單。');
      return;
    }
    setHint(node, '已同步 ' + (subscription.entries || []).length + ' 筆，更新時間 '
      + new Date(subscription.updatedAt).toLocaleString('zh-TW'), 'ok');
  }

  function bindSubscription() {
    $('btn-update-subscription').addEventListener('click', function () {
      const url = $('set-subscription').value.trim();
      setHint($('subscription-status'), '更新中…');
      chrome.runtime.sendMessage({ type: 'UPDATE_SUBSCRIPTION', url: url }, function (response) {
        if (chrome.runtime.lastError || !response) {
          setHint($('subscription-status'), '更新失敗：無法連線到背景服務', 'error');
          return;
        }
        if (!response.ok) {
          setHint($('subscription-status'), '更新失敗：' + response.error, 'error');
          return;
        }
        renderSubscriptionStatus();
        renderList();
      });
    });

    $('btn-clear-subscription').addEventListener('click', async function () {
      await SMA.storage.saveSubscription({ url: '', entries: [], updatedAt: null, error: null });
      await renderSubscriptionStatus();
      await renderList();
    });
  }

  // ------------------------------------------------------------- 新增項目

  function bindAddForm() {
    $('btn-add').addEventListener('click', async function () {
      const tags = $('new-tags').value.split(/[,，]/).map(function (t) { return t.trim(); }).filter(Boolean);
      const nameMatch = $('new-name-match').value.split(/[,，]/)
        .map(function (n) { return n.trim(); }).filter(Boolean);
      const raw = {
        platform: $('new-platform').value,
        handle: $('new-handle').value.trim(),
        profileId: $('new-profile-id').value.trim(),
        nameMatch: nameMatch,
        name: $('new-name').value.trim(),
        level: $('new-level').value,
        reason: $('new-reason').value.trim(),
        tags: tags,
        source: 'user'
      };
      try {
        await SMA.storage.addEntry(raw);
        ['new-handle', 'new-profile-id', 'new-name-match', 'new-name', 'new-tags', 'new-reason'].forEach(function (id) {
          $(id).value = '';
        });
        setHint($('add-status'), '已加入清單', 'ok');
        await renderList();
      } catch (err) {
        setHint($('add-status'), err.message, 'error');
      }
    });
  }

  // ------------------------------------------------------------- 清單

  function matchesFilter(entry) {
    if (filters.platform && entry.platform !== filters.platform) return false;
    if (filters.level && entry.level !== filters.level) return false;
    if (filters.text) {
      const haystack = [entry.handle, entry.profileId, entry.groupId, entry.name, entry.reason]
        .concat(entry.tags || [])
        .concat(entry.nameMatch || [])
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (haystack.indexOf(filters.text) === -1) return false;
    }
    return true;
  }

  function buildRow(entry, editable) {
    const tr = document.createElement('tr');

    const identity = document.createElement('td');
    identity.textContent = identityOf(entry);

    const name = document.createElement('td');
    name.textContent = entry.name || '—';

    const platform = document.createElement('td');
    platform.textContent = platformLabel(entry.platform);

    const level = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'pill pill--' + entry.level;
    pill.textContent = SMA.LEVELS[entry.level] ? SMA.LEVELS[entry.level].label : entry.level;
    level.appendChild(pill);

    if (!entry.handle && !entry.profileId && !entry.groupId
      && entry.nameMatch && entry.nameMatch.length) {
      const namePill = document.createElement('span');
      namePill.className = 'pill pill--name';
      namePill.textContent = '名稱比對';
      namePill.title = '這筆沒有網址代號，只能用粉專顯示名稱比對，可能對到同名的其他粉專。';
      level.appendChild(namePill);
    }

    const reason = document.createElement('td');
    reason.className = 'reason';
    reason.textContent = entry.reason || '—';

    const source = document.createElement('td');
    const sourcePill = document.createElement('span');
    sourcePill.className = 'pill pill--source';
    sourcePill.textContent = sourceLabel(entry.source);
    source.appendChild(sourcePill);

    const actions = document.createElement('td');
    if (editable) {
      const remove = document.createElement('button');
      remove.className = 'btn btn--link';
      remove.type = 'button';
      remove.textContent = '刪除';
      remove.addEventListener('click', async function () {
        await SMA.storage.removeEntry(entry.id);
        await renderList();
      });
      actions.appendChild(remove);
    }

    tr.append(identity, name, platform, level, reason, source, actions);
    return tr;
  }

  async function renderList() {
    const [entries, subscription] = await Promise.all([
      SMA.storage.getEntries(),
      SMA.storage.getSubscription()
    ]);
    const subEntries = (subscription.entries || []).map(function (entry) {
      return { entry: entry, editable: false };
    });
    const all = entries.map(function (entry) { return { entry: entry, editable: true }; }).concat(subEntries);
    const visible = all.filter(function (item) { return matchesFilter(item.entry); });

    const tbody = $('entry-rows');
    tbody.textContent = '';

    if (!visible.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'empty';
      td.colSpan = 7;
      td.textContent = all.length ? '沒有符合條件的項目。' : '清單是空的，先從上方新增一個帳號吧。';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      visible.forEach(function (item) {
        tbody.appendChild(buildRow(item.entry, item.editable));
      });
    }

    setHint($('list-status'), '共 ' + all.length + ' 筆（自訂 ' + entries.length
      + ' 筆、訂閱 ' + subEntries.length + ' 筆），目前顯示 ' + visible.length + ' 筆。');
  }

  function bindFilters() {
    $('filter-text').addEventListener('input', function (event) {
      filters.text = event.target.value.trim().toLowerCase();
      renderList();
    });
    $('filter-platform').addEventListener('change', function (event) {
      filters.platform = event.target.value;
      renderList();
    });
    $('filter-level').addEventListener('change', function (event) {
      filters.level = event.target.value;
      renderList();
    });
  }

  // ------------------------------------------------------------- 匯入匯出

  function bindImportExport() {
    $('btn-export').addEventListener('click', async function () {
      const entries = await SMA.storage.getEntries();
      const payload = {
        name: 'social-media-alert-list',
        version: 1,
        exportedAt: new Date().toISOString(),
        entries: entries
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'social-media-alert-' + new Date().toISOString().slice(0, 10) + '.json';
      link.click();
      URL.revokeObjectURL(url);
    });

    $('btn-import').addEventListener('click', function () {
      $('file-import').click();
    });

    $('file-import').addEventListener('change', async function (event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const incoming = Array.isArray(payload) ? payload : (payload.entries || []);
        const existing = await SMA.storage.getEntries();
        let added = 0;
        let skipped = 0;

        incoming.forEach(function (item) {
          const entry = SMA.normalizeEntryInput(Object.assign({}, item, { source: item.source || 'user' }));
          if (!SMA.isValidEntry(entry)) {
            skipped += 1;
            return;
          }
          const duplicated = existing.some(function (current) {
            return current.platform === entry.platform
              && current.handle === entry.handle
              && current.profileId === entry.profileId;
          });
          if (duplicated) {
            skipped += 1;
            return;
          }
          existing.push(entry);
          added += 1;
        });

        await SMA.storage.saveEntries(existing);
        setHint($('list-status'), '匯入完成：新增 ' + added + ' 筆，略過 ' + skipped + ' 筆。', 'ok');
        await renderList();
      } catch (err) {
        setHint($('list-status'), '匯入失敗：' + err.message, 'error');
      } finally {
        event.target.value = '';
      }
    });

    $('btn-reload-builtin').addEventListener('click', async function () {
      if (!window.confirm('要把內建清單重新匯入嗎？已經存在的項目會自動略過，你自己新增的不會被刪除。')) return;
      try {
        const response = await fetch(chrome.runtime.getURL('data/default-list.json'));
        const payload = await response.json();
        const existing = await SMA.storage.getEntries();
        let added = 0;

        (payload.entries || []).forEach(function (item) {
          const entry = SMA.normalizeEntryInput(Object.assign({}, item, { source: 'builtin' }));
          if (!SMA.isValidEntry(entry)) return;
          const nameKey = (entry.nameMatch || []).join('|');
          const duplicated = existing.some(function (current) {
            return current.platform === entry.platform
              && current.handle === entry.handle
              && current.profileId === entry.profileId
              && (current.nameMatch || []).join('|') === nameKey;
          });
          if (duplicated) return;
          existing.push(entry);
          added += 1;
        });

        await SMA.storage.saveEntries(existing);
        setHint($('list-status'), '內建清單已重新匯入：新增 ' + added + ' 筆。', 'ok');
        await renderList();
      } catch (err) {
        setHint($('list-status'), '重新載入失敗：' + err.message, 'error');
      }
    });

    $('btn-clear').addEventListener('click', async function () {
      if (!window.confirm('確定要清空所有自訂的警示項目嗎？此動作無法復原。')) return;
      await SMA.storage.saveEntries([]);
      await renderList();
    });
  }

  async function init() {
    await loadSettings();
    bindSettings();
    bindSubscription();
    bindAddForm();
    bindFilters();
    bindImportExport();
    await renderSubscriptionStatus();
    await renderList();
  }

  init();
})();

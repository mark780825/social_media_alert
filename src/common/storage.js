/**
 * chrome.storage 的薄封裝：集中管理設定、使用者清單與訂閱清單。
 * 同樣寫成傳統 script，掛在全域 SMA 命名空間。
 */
(function (root) {
  'use strict';

  const KEYS = {
    SETTINGS: 'settings',
    ENTRIES: 'entries',
    SUBSCRIPTION: 'subscription',
    STATS: 'stats'
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    showPageBanner: true,
    showFeedBadges: true,
    dimFlaggedPosts: true,
    showClearedNotice: true,
    minLevel: 'info',
    subscriptionUrl: '',
    autoUpdate: false,
    updateIntervalHours: 12
  };

  const DEFAULT_STATS = {
    alertsShown: 0,
    lastAlertAt: null
  };

  function storageArea() {
    if (typeof chrome === 'undefined' || !chrome.storage) return null;
    return chrome.storage.local;
  }

  function get(keys) {
    const area = storageArea();
    if (!area) return Promise.resolve({});
    return new Promise(function (resolve) {
      area.get(keys, function (result) {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('[social-media-alert] storage.get 失敗', chrome.runtime.lastError);
          resolve({});
          return;
        }
        resolve(result || {});
      });
    });
  }

  function set(items) {
    const area = storageArea();
    if (!area) return Promise.resolve();
    return new Promise(function (resolve) {
      area.set(items, function () {
        if (chrome.runtime && chrome.runtime.lastError) {
          console.warn('[social-media-alert] storage.set 失敗', chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  async function getSettings() {
    const data = await get(KEYS.SETTINGS);
    return Object.assign({}, DEFAULT_SETTINGS, data[KEYS.SETTINGS] || {});
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const next = Object.assign({}, current, patch || {});
    await set({ [KEYS.SETTINGS]: next });
    return next;
  }

  async function getEntries() {
    const data = await get(KEYS.ENTRIES);
    return Array.isArray(data[KEYS.ENTRIES]) ? data[KEYS.ENTRIES] : [];
  }

  async function saveEntries(entries) {
    await set({ [KEYS.ENTRIES]: entries });
    return entries;
  }

  async function getSubscription() {
    const data = await get(KEYS.SUBSCRIPTION);
    return Object.assign({ url: '', entries: [], updatedAt: null, error: null }, data[KEYS.SUBSCRIPTION] || {});
  }

  async function saveSubscription(subscription) {
    await set({ [KEYS.SUBSCRIPTION]: subscription });
    return subscription;
  }

  /** 使用者清單 + 訂閱清單，content script 實際比對用的完整清單。 */
  async function getAllEntries() {
    const [entries, subscription] = await Promise.all([getEntries(), getSubscription()]);
    const subEntries = Array.isArray(subscription.entries) ? subscription.entries : [];
    return entries.concat(subEntries);
  }

  async function addEntry(rawEntry) {
    const entry = root.SMA.normalizeEntryInput(rawEntry);
    if (!root.SMA.isValidEntry(entry)) {
      throw new Error('項目至少要有帳號代號、數字 ID、社團代號或要比對的粉專名稱');
    }
    const entries = await getEntries();
    const nameKey = (entry.nameMatch || []).join('|');
    const duplicated = entries.some(function (item) {
      return item.platform === entry.platform
        && item.handle === entry.handle
        && item.profileId === entry.profileId
        && (item.groupId || '') === (entry.groupId || '')
        && (item.nameMatch || []).join('|') === nameKey;
    });
    if (duplicated) {
      throw new Error('這個帳號已經在清單中了');
    }
    entries.push(entry);
    await saveEntries(entries);
    return entry;
  }

  async function updateEntry(id, patch) {
    const entries = await getEntries();
    const index = entries.findIndex(function (item) { return item.id === id; });
    if (index === -1) throw new Error('找不到要更新的項目');
    const merged = root.SMA.normalizeEntryInput(Object.assign({}, entries[index], patch, { id: id }));
    entries[index] = merged;
    await saveEntries(entries);
    return merged;
  }

  async function removeEntry(id) {
    const entries = await getEntries();
    const next = entries.filter(function (item) { return item.id !== id; });
    await saveEntries(next);
    return next;
  }

  async function getStats() {
    const data = await get(KEYS.STATS);
    return Object.assign({}, DEFAULT_STATS, data[KEYS.STATS] || {});
  }

  async function bumpAlertCount(count) {
    const stats = await getStats();
    stats.alertsShown += count || 1;
    stats.lastAlertAt = new Date().toISOString();
    await set({ [KEYS.STATS]: stats });
    return stats;
  }

  function onChanged(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'local') return;
      callback(changes);
    });
  }

  root.SMA = Object.assign(root.SMA || {}, {
    KEYS: KEYS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    storage: {
      get: get,
      set: set,
      getSettings: getSettings,
      saveSettings: saveSettings,
      getEntries: getEntries,
      saveEntries: saveEntries,
      getSubscription: getSubscription,
      saveSubscription: saveSubscription,
      getAllEntries: getAllEntries,
      addEntry: addEntry,
      updateEntry: updateEntry,
      removeEntry: removeEntry,
      getStats: getStats,
      bumpAlertCount: bumpAlertCount,
      onChanged: onChanged
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);

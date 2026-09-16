/**
 * Service worker：安裝時載入示範清單、維護分頁徽章、定期更新訂閱清單。
 */
importScripts('../common/matcher.js', '../common/storage.js');

const SMA = self.SMA;
const SUBSCRIPTION_ALARM = 'sma-subscription-update';

const BADGE_COLORS = {
  danger: '#d93025',
  warning: '#f29900',
  info: '#1a73e8'
};

async function loadBuiltinList() {
  const existing = await SMA.storage.getEntries();
  if (existing.length) return;
  try {
    const response = await fetch(chrome.runtime.getURL('data/default-list.json'));
    const payload = await response.json();
    const entries = (payload.entries || [])
      .map(function (item) {
        return SMA.normalizeEntryInput(Object.assign({}, item, { source: 'builtin' }));
      })
      .filter(SMA.isValidEntry);
    if (entries.length) {
      await SMA.storage.saveEntries(entries);
    }
  } catch (err) {
    console.warn('[social-media-alert] 無法載入示範清單', err);
  }
}

function setBadge(tabId, payload) {
  if (typeof tabId !== 'number') return;
  const count = payload && payload.matchCount ? payload.matchCount : 0;
  if (!count) {
    chrome.action.setBadgeText({ tabId: tabId, text: '' });
    return;
  }
  const level = payload.level || 'warning';
  chrome.action.setBadgeText({ tabId: tabId, text: '!' });
  chrome.action.setBadgeBackgroundColor({
    tabId: tabId,
    color: BADGE_COLORS[level] || BADGE_COLORS.warning
  });
}

/** 從遠端網址下載清單並寫入訂閱區。支援 {entries:[...]} 或直接是陣列。 */
async function updateSubscription(url) {
  const settings = await SMA.storage.getSettings();
  const targetUrl = url || settings.subscriptionUrl;
  if (!targetUrl) {
    throw new Error('尚未設定訂閱清單網址');
  }

  const response = await fetch(targetUrl, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error('下載失敗：HTTP ' + response.status);
  }
  const payload = await response.json();
  const rawEntries = Array.isArray(payload) ? payload : (payload.entries || []);
  const entries = rawEntries
    .map(function (item) {
      return SMA.normalizeEntryInput(Object.assign({}, item, { source: 'subscription:' + targetUrl }));
    })
    .filter(SMA.isValidEntry);

  const subscription = {
    url: targetUrl,
    entries: entries,
    updatedAt: new Date().toISOString(),
    error: null
  };
  await SMA.storage.saveSubscription(subscription);
  return subscription;
}

async function scheduleSubscriptionAlarm() {
  const settings = await SMA.storage.getSettings();
  await chrome.alarms.clear(SUBSCRIPTION_ALARM);
  if (!settings.autoUpdate || !settings.subscriptionUrl) return;
  const minutes = Math.max(30, (settings.updateIntervalHours || 12) * 60);
  chrome.alarms.create(SUBSCRIPTION_ALARM, { periodInMinutes: minutes, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(function () {
  loadBuiltinList().then(scheduleSubscriptionAlarm);
});

chrome.runtime.onStartup.addListener(function () {
  scheduleSubscriptionAlarm();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== SUBSCRIPTION_ALARM) return;
  updateSubscription().catch(async function (err) {
    const subscription = await SMA.storage.getSubscription();
    subscription.error = err.message;
    await SMA.storage.saveSubscription(subscription);
  });
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.settings) {
    scheduleSubscriptionAlarm();
  }
});

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || !message.type) return undefined;

  if (message.type === 'PAGE_STATUS_CHANGED') {
    setBadge(sender.tab && sender.tab.id, message.payload);
    return undefined;
  }

  if (message.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return undefined;
  }

  if (message.type === 'UPDATE_SUBSCRIPTION') {
    updateSubscription(message.url)
      .then(function (subscription) {
        sendResponse({ ok: true, subscription: subscription });
      })
      .catch(function (err) {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  return undefined;
});

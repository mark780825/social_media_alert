/**
 * 檢舉頁邏輯：把表單整理成一則公開的 GitHub Issue，並顯示目前已收錄的清單。
 * 沒有後端、沒有追蹤，所有動作都在瀏覽器本機完成。
 */
(function () {
  'use strict';

  const REPO = 'mark780825/social_media_alert';
  const ISSUE_NEW = 'https://github.com/' + REPO + '/issues/new';
  const LIST_URL = 'data/default-list.json';
  // GitHub 對預填網址有長度限制，超過就改走「複製內容」。
  const MAX_URL_LENGTH = 7000;

  const SMA = window.SMA || null;
  const $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------ 表單

  const form = $('report-form');
  const fields = {
    name: $('f-name'),
    url: $('f-url'),
    detail: $('f-detail'),
    evidence: $('f-evidence'),
    transparency: $('f-transparency'),
    contact: $('f-contact'),
    confirm: $('f-confirm')
  };

  function selectedCategories() {
    return Array.prototype.slice
      .call($('f-categories').querySelectorAll('input[type="checkbox"]:checked'))
      .map(function (input) { return input.value; });
  }

  /** 用擴充功能同一套解析邏輯，讓檢舉內容直接帶上可比對的代號。 */
  function parseTarget(url) {
    if (!SMA || !url) return null;
    try {
      return SMA.parseProfileTarget(url);
    } catch (err) {
      return null;
    }
  }

  function describeTarget(target) {
    if (!target) return '（無法自動解析，查證時人工確認）';
    const platform = target.platform === 'facebook' ? 'Facebook' : 'Threads';
    if (target.kind === 'id') return platform + '｜數字 ID `' + target.value + '`';
    if (target.kind === 'group') return platform + '｜社團 `' + target.value + '`';
    return platform + '｜代號 `' + target.value + '`';
  }

  function bulletList(text) {
    const lines = String(text || '')
      .split('\n')
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
    if (!lines.length) return '（未提供）';
    return lines.map(function (line) { return '- ' + line; }).join('\n');
  }

  function buildIssueTitle() {
    const target = parseTarget(fields.url.value.trim());
    const suffix = target && target.kind === 'handle' ? '（@' + target.value + '）' : '';
    return '[檢舉] ' + fields.name.value.trim() + suffix;
  }

  function buildIssueBody() {
    const target = parseTarget(fields.url.value.trim());
    const categories = selectedCategories();

    return [
      '## 檢舉對象',
      '',
      '- **粉專名稱**：' + fields.name.value.trim(),
      '- **網址**：' + fields.url.value.trim(),
      '- **解析結果**：' + describeTarget(target),
      '',
      '## 檢舉分類',
      '',
      categories.length ? categories.map(function (c) { return '- ' + c; }).join('\n') : '（未選擇）',
      '',
      '## 具體說明',
      '',
      fields.detail.value.trim(),
      '',
      '## 佐證連結',
      '',
      bulletList(fields.evidence.value),
      '',
      '## 透明度資訊觀察',
      '',
      fields.transparency.value.trim() || '（未提供）',
      '',
      '## 檢舉者聯絡方式',
      '',
      fields.contact.value.trim() || '（未提供）',
      '',
      '---',
      '',
      '送出者已確認：內容為可查證的觀察而非個人猜測，並了解被檢舉不等於被收錄。',
      '',
      '### 查證檢核（由維護者填寫）',
      '',
      '- [ ] 粉專仍存在且可存取',
      '- [ ] 已確認頁面透明度資訊（建立日期／管理員所在地／曾用名稱）',
      '- [ ] 佐證連結可開啟且與描述相符',
      '- [ ] 不屬於「只是立場不同」「個人帳號」「無依據猜測」等排除情況',
      '- [ ] 已確認不是同名的其他粉專',
      '- [ ] 決定：收錄等級 `danger` / `warning` / `info`，或退回、或標為 `safe`'
    ].join('\n');
  }

  function markInvalid(el, invalid) {
    if (!el) return;
    el.classList.toggle('invalid', Boolean(invalid));
  }

  function validate() {
    const problems = [];

    const name = fields.name.value.trim();
    markInvalid(fields.name, !name);
    if (!name) problems.push('請填寫粉專名稱');

    const url = fields.url.value.trim();
    const target = parseTarget(url);
    const urlOk = /^https?:\/\//i.test(url);
    markInvalid(fields.url, !urlOk);
    if (!urlOk) problems.push('請填寫完整的粉專網址（以 http:// 或 https:// 開頭）');
    else if (!target) problems.push('這個網址看起來不是 Facebook／Threads 的粉專頁，請再確認一次');

    if (!selectedCategories().length) problems.push('請至少勾選一個檢舉分類');

    const detail = fields.detail.value.trim();
    markInvalid(fields.detail, detail.length < 30);
    if (detail.length < 30) problems.push('具體說明至少 30 字，請描述你實際觀察到什麼');

    if (!fields.confirm.checked) problems.push('請勾選最下方的確認事項');

    return problems;
  }

  function setStatus(message, type) {
    const node = $('form-status');
    node.textContent = message || '';
    node.className = 'form-status' + (type ? ' form-status--' + type : '');
  }

  function refreshPreview() {
    const hasInput = fields.name.value.trim() || fields.url.value.trim() || fields.detail.value.trim();
    $('preview-body').textContent = hasInput
      ? buildIssueTitle() + '\n\n' + buildIssueBody()
      : '（填寫表單後這裡會顯示）';
  }

  function issueUrl() {
    return ISSUE_NEW
      + '?labels=' + encodeURIComponent('檢舉,待查證')
      + '&title=' + encodeURIComponent(buildIssueTitle())
      + '&body=' + encodeURIComponent(buildIssueBody());
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    const problems = validate();
    if (problems.length) {
      setStatus('還差一點：' + problems.join('；'), 'error');
      return;
    }

    const url = issueUrl();
    if (url.length > MAX_URL_LENGTH) {
      setStatus('內容太長，沒辦法用網址帶過去。請改按「複製內容」，再貼到新開的 Issue 裡。', 'error');
      return;
    }

    window.open(url, '_blank', 'noopener');
    setStatus('已開啟 GitHub 頁面，內容都幫你填好了，按下 Create 就完成。沒跳出來的話請確認瀏覽器是否擋了彈出視窗。', 'ok');
  });

  $('btn-copy').addEventListener('click', async function () {
    const text = buildIssueTitle() + '\n\n' + buildIssueBody();
    try {
      await navigator.clipboard.writeText(text);
      setStatus('已複製到剪貼簿，可以貼到 Issue 或其他管道。', 'ok');
    } catch (err) {
      $('preview-body').textContent = text;
      $('preview-body').parentNode.open = true;
      setStatus('瀏覽器不允許自動複製，內容已展開在下方「預覽」，請手動複製。', 'error');
    }
  });

  $('btn-reset').addEventListener('click', function () {
    form.reset();
    Object.keys(fields).forEach(function (key) { markInvalid(fields[key], false); });
    $('url-hint').textContent = '貼上粉專首頁網址，系統會自動解析出帳號代號。';
    $('url-hint').className = 'hint';
    setStatus('');
    refreshPreview();
  });

  // 邊填邊回饋：解析網址、提示字數
  fields.url.addEventListener('input', function () {
    const value = fields.url.value.trim();
    const hint = $('url-hint');
    if (!value) {
      hint.textContent = '貼上粉專首頁網址，系統會自動解析出帳號代號。';
      hint.className = 'hint';
    } else {
      const target = parseTarget(value);
      if (target) {
        hint.textContent = '✔ 解析到 ' + describeTarget(target).replace(/`/g, '');
        hint.className = 'hint hint--ok';
        markInvalid(fields.url, false);
      } else {
        hint.textContent = '這個網址解析不出粉專帳號，請確認是不是粉專首頁（例如 facebook.com/粉專代號）。';
        hint.className = 'hint hint--warn';
      }
    }
    refreshPreview();
  });

  fields.detail.addEventListener('input', function () {
    const length = fields.detail.value.trim().length;
    const hint = $('detail-hint');
    if (!length) {
      hint.textContent = '至少 30 字。寫得越具體，查證越快。';
      hint.className = 'hint';
    } else if (length < 30) {
      hint.textContent = '還差 ' + (30 - length) + ' 字。';
      hint.className = 'hint hint--warn';
    } else {
      hint.textContent = '已填 ' + length + ' 字。';
      hint.className = 'hint hint--ok';
      markInvalid(fields.detail, false);
    }
    refreshPreview();
  });

  ['name', 'evidence', 'transparency', 'contact'].forEach(function (key) {
    fields[key].addEventListener('input', refreshPreview);
  });
  $('f-categories').addEventListener('change', refreshPreview);

  // 申訴連結：同樣預填一則 Issue
  $('btn-appeal').href = ISSUE_NEW
    + '?labels=' + encodeURIComponent('申訴')
    + '&title=' + encodeURIComponent('[申訴] 粉專名稱')
    + '&body=' + encodeURIComponent([
      '## 申訴的粉專',
      '',
      '- 粉專名稱：',
      '- 網址：',
      '- 我的身分：（經營者／管理員／其他）',
      '',
      '## 申訴理由',
      '',
      '（請說明清單上的依據哪裡有誤）',
      '',
      '## 佐證資料',
      '',
      '（頁面透明度截圖、公司登記、經營說明等）'
    ].join('\n'));

  // ------------------------------------------------------------ 已收錄清單

  const LEVEL_LABEL = { danger: '高風險', warning: '需留意', info: '提醒', safe: '已澄清' };
  let allEntries = [];

  function identityOf(entry) {
    if (entry.handle) return '@' + entry.handle;
    if (entry.profileId) return 'ID ' + entry.profileId;
    if (entry.groupId) return '社團 ' + entry.groupId;
    if (entry.nameMatch && entry.nameMatch.length) return entry.nameMatch.join('、');
    return '—';
  }

  function isNameOnly(entry) {
    return !entry.handle && !entry.profileId && !entry.groupId
      && entry.nameMatch && entry.nameMatch.length;
  }

  function renderRows(entries) {
    const tbody = $('list-rows');
    tbody.textContent = '';

    if (!entries.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'empty';
      td.colSpan = 4;
      td.textContent = '沒有符合條件的項目。';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    entries.forEach(function (entry) {
      const tr = document.createElement('tr');

      const name = document.createElement('td');
      name.className = 'name';
      name.textContent = entry.name || '（未命名）';

      const ident = document.createElement('td');
      ident.className = 'ident';
      ident.textContent = identityOf(entry);
      if (isNameOnly(entry)) {
        const pill = document.createElement('span');
        pill.className = 'pill pill--name';
        pill.textContent = '名稱比對';
        pill.title = '這筆沒有網址代號，只能用粉專顯示名稱比對。';
        ident.appendChild(document.createTextNode(' '));
        ident.appendChild(pill);
      }

      const level = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = 'pill pill--' + entry.level;
      pill.textContent = LEVEL_LABEL[entry.level] || entry.level;
      level.appendChild(pill);

      const why = document.createElement('td');
      why.className = 'why';
      why.textContent = entry.reason || '—';

      tr.append(name, ident, level, why);
      tbody.appendChild(tr);
    });
  }

  function applyFilters() {
    const keyword = $('list-search').value.trim().toLowerCase();
    const level = $('list-level').value;

    const filtered = allEntries.filter(function (entry) {
      if (level && entry.level !== level) return false;
      if (!keyword) return true;
      const haystack = [entry.name, entry.handle, entry.profileId, entry.reason]
        .concat(entry.tags || [])
        .concat(entry.nameMatch || [])
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.indexOf(keyword) !== -1;
    });

    renderRows(filtered);
  }

  function renderSummary(payload) {
    const counts = allEntries.reduce(function (acc, entry) {
      acc[entry.level] = (acc[entry.level] || 0) + 1;
      return acc;
    }, {});

    const parts = ['danger', 'warning', 'info', 'safe']
      .filter(function (key) { return counts[key]; })
      .map(function (key) { return LEVEL_LABEL[key] + ' ' + counts[key] + ' 筆'; });

    $('list-summary').textContent = '目前共 ' + allEntries.length + ' 筆（' + parts.join('、') + '）'
      + (payload.updatedAt ? '，更新於 ' + payload.updatedAt : '') + '。';
  }

  function renderGaps(payload) {
    const box = $('list-gaps');
    box.textContent = '';
    if (!payload.gaps || !payload.gaps.length) return;

    const title = document.createElement('h3');
    title.textContent = '已知缺口（公開資料查不到名稱，清單裡就沒有）';
    const ul = document.createElement('ul');
    payload.gaps.forEach(function (gap) {
      const li = document.createElement('li');
      li.textContent = gap;
      ul.appendChild(li);
    });
    box.append(title, ul);
  }

  function loadList() {
    fetch(LIST_URL, { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (payload) {
        allEntries = payload.entries || [];
        renderSummary(payload);
        renderGaps(payload);
        applyFilters();
      })
      .catch(function (err) {
        $('list-summary').textContent = '清單載入失敗（' + err.message + '），可以到 GitHub 直接查看 data/default-list.json。';
        renderRows([]);
      });
  }

  $('list-search').addEventListener('input', applyFilters);
  $('list-level').addEventListener('change', applyFilters);

  loadList();
  refreshPreview();
})();

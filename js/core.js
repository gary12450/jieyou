// 共用：全域狀態、事件登記表、跳脫、對話框、loading、Modal、API、勾選清單

const state = {
    members: [], items: [], competitions: [], guilds: [],
    memberMap: new Map(), itemMap: new Map(),
    tab: 'members', itemCategory: '', compPeriod: null
};

// 事件委派登記表：HTML 用 data-act / data-form / data-input / data-change 指名，由 app.js 統一分派
const ACTIONS = {};   // data-act   → (id, el, event)
const FORMS = {};     // data-form  → (form)
const INPUTS = {};    // data-input、data-change → (el)

function $(id) { return document.getElementById(id); }
function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) { return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, c => ESC_MAP[c]); }

const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });
function byText(a, b) { return collator.compare(String(a || ''), String(b || '')); }

function categoryIcon(name) {
    const c = CATEGORIES.find(x => x.name === name);
    return c ? c.icon : '📦';
}
// 設定中的類別 + 資料中出現、但設定已移除的類別
function categoriesInUse() {
    const names = CATEGORIES.map(c => c.name);
    state.items.forEach(i => { if (i.category && !names.includes(i.category)) names.push(i.category); });
    return names;
}

// 期別預設用 ISO 週：「2026年第44週」（週數補零，排序才正確）
function currentPeriod() {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return d.getUTCFullYear() + '年第' + String(week).padStart(2, '0') + '週';
}

function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- 資料狀態 ----------

const LIST_FIELDS = { members: ['ownedItems'], items: [], competitions: ['selectedItems'] };

// 後端回傳的資料補齊型別：id 一律字串、清單一律字串陣列、其他欄位缺值補空字串
function normRecord(type, rec) {
    const out = Object.assign({}, rec, { id: String(rec.id) });
    LIST_FIELDS[type].forEach(k => { out[k] = Array.isArray(rec[k]) ? rec[k].map(String) : []; });
    Object.keys(out).forEach(k => { if (out[k] === null || out[k] === undefined) out[k] = ''; });
    return out;
}

function rebuildMaps() {
    state.memberMap = new Map(state.members.map(m => [m.id, m]));
    state.itemMap = new Map(state.items.map(i => [i.id, i]));
}

function setData(data) {
    ['members', 'items', 'competitions'].forEach(t => { state[t] = (data[t] || []).map(r => normRecord(t, r)); });
    state.guilds = Array.isArray(data.guilds) ? data.guilds.map(String) : [];
    rebuildMaps();
}

// 新增或取代一筆（依 id）
function upsertRecord(type, rec) {
    const r = normRecord(type, rec);
    const idx = state[type].findIndex(x => x.id === r.id);
    state[type] = idx >= 0 ? state[type].map((x, i) => (i === idx ? r : x)) : state[type].concat([r]);
    rebuildMaps();
}

function removeRecord(type, id) {
    state[type] = state[type].filter(x => x.id !== String(id));
    rebuildMaps();
}

// 表格的編輯／刪除按鈕：沒有權限就不顯示
function actionButtons(prefix, rec, extra) {
    const own = canEdit(rec.ownerId)
        ? `<button class="icon-btn" data-act="${prefix}-edit" data-id="${esc(rec.id)}" title="編輯" aria-label="編輯">✏️</button>` +
          `<button class="icon-btn" data-act="${prefix}-delete" data-id="${esc(rec.id)}" title="刪除" aria-label="刪除">🗑️</button>`
        : '';
    return (extra || '') + own || '<span class="muted">—</span>';
}

function emptyRow(cols, text) {
    return `<tr class="empty-row"><td colspan="${cols}">${esc(text)}</td></tr>`;
}

function tagsHtml(names, max) {
    if (!names.length) return '<span class="muted">—</span>';
    const shown = max ? names.slice(0, max) : names;
    const more = names.length - shown.length;
    return '<div class="tags">' + shown.map(n => `<span class="tag">${esc(n)}</span>`).join('') +
        (more > 0 ? `<span class="tag missing">+${more}</span>` : '') + '</div>';
}

// ---------- loading（計數器式，連續呼叫不閃爍） ----------

let loadingCount = 0;
function showLoading(msg) {
    loadingCount++;
    setLoadingText(msg || '處理中...');
    $('loading').classList.add('show');
}
function hideLoading() {
    loadingCount = Math.max(0, loadingCount - 1);
    if (loadingCount === 0) $('loading').classList.remove('show');
}
function setLoadingText(msg) { $('loading-text').textContent = msg; }

// ---------- 對話框（取代原生 alert / confirm） ----------

function openDialog(message, buttons) {
    return new Promise(resolve => {
        const overlay = $('dialog');
        $('dialog-msg').textContent = message;
        const box = $('dialog-buttons');
        box.innerHTML = '';
        buttons.forEach(b => {
            const el = document.createElement('button');
            el.type = 'button';
            el.textContent = b.text;
            el.className = 'btn ' + b.cls;
            el.onclick = () => { overlay.classList.remove('show'); resolve(b.val); };
            box.appendChild(el);
        });
        overlay.classList.add('show');
        box.lastChild.focus();
    });
}
function notify(message) { return openDialog(message, [{ text: '確定', cls: 'btn-primary', val: true }]); }
function confirmBox(message, okText) {
    return openDialog(message, [
        { text: '取消', cls: 'btn-ghost', val: false },
        { text: okText || '確認', cls: 'btn-primary', val: true }
    ]);
}

// ---------- Modal ----------

function openModal(html, wide) {
    $('modal-body').innerHTML = html;
    $('modal-content').classList.toggle('wide', !!wide);
    $('modal').classList.add('show');
    $('modal-body').querySelectorAll('.checklist').forEach(refreshChecklist);
    const first = $('modal-body').querySelector('input:not([type=checkbox]):not([type=hidden]), select, textarea');
    if (first) setTimeout(() => first.focus(), 50);
}
function closeModal() { $('modal').classList.remove('show'); }
function isModalOpen() { return $('modal').classList.contains('show'); }

ACTIONS['modal-close'] = () => closeModal();
ACTIONS['modal-backdrop'] = (id, el, ev) => { if (ev.target === el) closeModal(); };

function detailRow(label, value) {
    const v = value === '' || value === undefined || value === null ? '—' : value;
    return `<div class="detail-row"><span class="detail-label">${esc(label)}</span><span class="detail-value">${esc(v)}</span></div>`;
}

// ---------- 讀取：自動重試 ----------
// 花非花實測（2026-08-05）：Apps Script 的 /exec 偶爾會回 404 錯誤頁（同網址連打 8 次失敗 3 次），
// 成功回應 2.7～35 秒、失敗的反而更慢；唯讀請求自動重試幾乎都能拿到資料。
// 失敗訊息依「實際收到什麼」產生，不寫死結論。寫入（POST）不自動重試，避免重複新增。
const FETCH_MAX_ATTEMPTS = 4;
const FETCH_RETRY_DELAYS = [800, 1800, 3500];
const FETCH_TIMEOUT_MS = 45000;
const FETCH_TOTAL_BUDGET_MS = 100000;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function describeFailure(res, text, error, waitedMs) {
    const head = (text || '').trim().slice(0, 80).replace(/\s+/g, ' ');
    const type = res ? (res.headers.get('content-type') || '未提供') : '';
    if (error && error.name === 'AbortError') {
        return {
            detail: '等待 ' + Math.round((waitedMs || 0) / 1000) + ' 秒仍沒有收到完整回應，已主動中止。' +
                (res ? '（已連上，HTTP ' + res.status + '，但內容沒傳完）' : '（一直沒有連上）'),
            hint: '這次伺服器回應太慢，通常稍後再試就會恢復。'
        };
    }
    if (!res) {
        return {
            detail: '連不上伺服器：' + ((error && error.message) || '未知的網路錯誤'),
            hint: '請確認網路連線是否正常（公司或校園網路也可能擋掉 Google 服務）。'
        };
    }
    if (!res.ok) {
        return {
            detail: '伺服器回應 HTTP ' + res.status + '（內容型態 ' + type + '）\n收到的開頭：' + head,
            hint: '這次伺服器沒有回傳資料，通常稍後再試就會恢復。'
        };
    }
    if (error) {
        const isParse = error instanceof SyntaxError;
        return {
            detail: 'HTTP ' + res.status + (isParse ? '，但 JSON 解析失敗：' : '，但讀取回應時中斷：') + error.message +
                (isParse ? '\n收到的開頭：' + head : ''),
            hint: isParse ? '收到的內容確實是壞掉的資料，請檢查 Google 試算表。' : '回應沒有收完整，通常稍後再試就會恢復。'
        };
    }
    return {
        detail: 'HTTP ' + res.status + '，但回傳的不是資料而是網頁（內容型態 ' + type + '）\n收到的開頭：' + head,
        hint: '這次伺服器回的是網頁而不是資料，通常稍後再試就會恢復。'
    };
}

async function fetchOnce(url, options, timeoutMs) {
    let res = null;
    let text = '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
        res = await fetch(url, Object.assign({ signal: controller.signal }, options));
        text = await res.text();
        const trimmed = text.trim();
        if (res.ok && (trimmed.startsWith('{') || trimmed.startsWith('['))) return { data: JSON.parse(trimmed) };
        return { failure: describeFailure(res, text, null, Date.now() - startedAt), text };
    } catch (e) {
        return { failure: describeFailure(res, text, e, Date.now() - startedAt), text };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchJsonWithRetry(url, loadingMsg) {
    const startedAt = Date.now();
    let last = null;
    let attempt = 0;
    while (attempt < FETCH_MAX_ATTEMPTS) {
        attempt++;
        const budgetLeft = FETCH_TOTAL_BUDGET_MS - (Date.now() - startedAt);
        const sep = url.indexOf('?') >= 0 ? '&' : '?';
        const r = await fetchOnce(url + sep + '_t=' + Date.now(), {}, Math.min(FETCH_TIMEOUT_MS, budgetLeft));
        if (r.data) return r.data;
        last = r.failure;
        console.warn('第 ' + attempt + ' 次讀取失敗 → ' + last.detail, (r.text || '').slice(0, 300));
        if (attempt >= FETCH_MAX_ATTEMPTS) break;
        const wait = FETCH_RETRY_DELAYS[attempt - 1];
        if (FETCH_TOTAL_BUDGET_MS - (Date.now() - startedAt) <= wait + 2000) break;
        setLoadingText(loadingMsg + '（連線不穩，' + Math.round(wait / 1000) + ' 秒後自動重試 ' + attempt + '/' + (FETCH_MAX_ATTEMPTS - 1) + '）');
        await delay(wait);
        setLoadingText(loadingMsg + '（重試中 ' + attempt + '/' + (FETCH_MAX_ATTEMPTS - 1) + '）');
    }
    throw new Error('嘗試 ' + attempt + ' 次、共等待 ' + Math.round((Date.now() - startedAt) / 1000) +
        ' 秒仍未取得資料。\n\n【最後一次的實際狀況】\n' + last.detail + '\n\n' + last.hint);
}

// ---------- 寫入：自動帶 token，不設 Content-Type（text/plain 可避開 CORS preflight） ----------

const POST_MESSAGES = { login: '登入中...', register: '註冊中...', addItem: '儲存中...', updateItem: '儲存中...', deleteItem: '刪除中...' };

async function apiPost(payload) {
    showLoading(POST_MESSAGES[payload.action] || '處理中...');
    try {
        const body = Object.assign({}, payload);
        if (session && session.token) body.token = session.token;
        const r = await fetchOnce(API_URL, { method: 'POST', body: JSON.stringify(body) }, FETCH_TIMEOUT_MS);
        if (r.data) {
            if (r.data.authExpired) onAuthExpired();
            return r.data;
        }
        console.error('寫入請求失敗 → ' + r.failure.detail, (r.text || '').slice(0, 300));
        throw new Error('這次操作沒有收到伺服器的正常回應。\n\n【實際狀況】\n' + r.failure.detail + '\n\n' + r.failure.hint +
            '\n\n⚠️ 這次操作可能沒完成，也可能其實已經成功。請重新整理頁面確認資料狀態，再決定要不要重做一次。');
    } finally {
        hideLoading();
    }
}

// 呼叫 apiPost 並處理失敗訊息；成功回傳結果，失敗回傳 null
async function apiCall(payload, failPrefix) {
    try {
        const r = await apiPost(payload);
        if (r && r.success) return r;
        await notify(failPrefix + '：' + ((r && r.error) || '未知錯誤'));
    } catch (e) {
        await notify(failPrefix + '：' + e.message);
    }
    return null;
}

// ---------- 勾選清單（成員擁有項目、競賽參賽項目、設定誰擁有 共用） ----------
// options: [{ value, label, group, sub }]；groups: 要顯示成篩選籤的分組名稱

function checklistHtml(id, options, checkedValues, groups, emptyText) {
    const checked = new Set((checkedValues || []).map(String));
    const counts = {};
    options.forEach(o => { counts[o.group] = (counts[o.group] || 0) + 1; });
    const chips = groups.filter(g => counts[g]).map(g =>
        `<button type="button" class="chip" data-act="checklist-group" data-id="${esc(g)}">${esc(g)}<small>${counts[g]}</small></button>`).join('');
    const boxes = options.length === 0
        ? `<div class="checklist-empty">${esc(emptyText || '沒有可選的項目')}</div>`
        : options.map(o => `
            <label class="check-item" data-group="${esc(o.group)}" data-text="${esc(String(o.label + ' ' + (o.sub || '')).toLowerCase())}" title="${esc(o.label)}">
                <input type="checkbox" name="${esc(id)}" value="${esc(o.value)}" data-change="checklist" ${checked.has(String(o.value)) ? 'checked' : ''}>
                <span>${esc(o.label)}</span>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}
            </label>`).join('');
    return `
        <div class="checklist" id="${esc(id)}" data-group="">
            <div class="checklist-tools">
                <input type="search" class="checklist-search" placeholder="🔍 搜尋…" data-input="checklist">
                <label class="checklist-only"><input type="checkbox" class="only-checked" data-change="checklist"> 只看已勾選</label>
                <button type="button" class="btn btn-ghost btn-sm" data-act="checklist-all" data-id="1">全選</button>
                <button type="button" class="btn btn-ghost btn-sm" data-act="checklist-all" data-id="0">全不選</button>
                <span class="checklist-count"></span>
                ${chips ? `<div class="chip-row"><button type="button" class="chip active" data-act="checklist-group" data-id="">全部<small>${options.length}</small></button>${chips}</div>` : ''}
            </div>
            <div class="checklist-box">${boxes}</div>
        </div>`;
}

function checklistValues(id) {
    return Array.from(document.querySelectorAll(`#${CSS.escape(id)} .checklist-box input[type=checkbox]:checked`)).map(cb => cb.value);
}

function refreshChecklist(root) {
    const q = root.querySelector('.checklist-search').value.trim().toLowerCase();
    const onlyChecked = root.querySelector('.only-checked').checked;
    const group = root.dataset.group;
    root.querySelectorAll('.check-item').forEach(label => {
        const cb = label.querySelector('input');
        const show = (!q || label.dataset.text.includes(q)) && (!group || label.dataset.group === group) && (!onlyChecked || cb.checked);
        label.classList.toggle('hidden', !show);
    });
    root.querySelector('.checklist-count').textContent = '已選 ' + root.querySelectorAll('.checklist-box input:checked').length;
}

INPUTS.checklist = el => refreshChecklist(el.closest('.checklist'));
ACTIONS['checklist-group'] = (group, el) => {
    const root = el.closest('.checklist');
    root.dataset.group = group;
    root.querySelectorAll('[data-act="checklist-group"]').forEach(c => c.classList.toggle('active', c === el));
    refreshChecklist(root);
};
// 全選／全不選只作用在目前看得到的項目
ACTIONS['checklist-all'] = (on, el) => {
    const root = el.closest('.checklist');
    root.querySelectorAll('.check-item:not(.hidden) input').forEach(cb => { cb.checked = on === '1'; });
    refreshChecklist(root);
};

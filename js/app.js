// 進入點：載入資料、分頁切換、摘要列、事件委派

const TABS = ['members', 'items', 'competitions'];

function renderSummary() {
    const thisPeriod = currentPeriod();
    const n = state.competitions.filter(c => c.period === thisPeriod).length;
    $('summary-bar').innerHTML = [
        `👥 ${state.members.length} 位成員`,
        `📖 ${state.items.length} 筆圖鑑`,
        `🏆 本週 ${n} 筆競賽`,
        `🏝️ ${state.guilds.length} 個公會`
    ].map(s => `<span>${s}</span>`).join('<span>·</span>');
}

function renderAll() {
    renderAuthUI();
    renderSummary();
    renderGuildPanel();
    renderMemberFilters();
    renderMembers();
    renderItemCats();
    renderItems();
    renderCompFilters();
    renderCompetitions();
}

function switchTab(tab) {
    if (!TABS.includes(tab)) tab = 'members';
    state.tab = tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.id === tab));
    TABS.forEach(t => $('tab-' + t).classList.toggle('active', t === tab));
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
}

ACTIONS.tab = tab => switchTab(tab);
INPUTS.members = () => renderMembers();
INPUTS.items = () => renderItems();
INPUTS.competitions = el => {
    if (el.id === 'comp-period') state.compPeriod = el.value;
    renderCompetitions();
};

async function loadData() {
    let error = null;
    showLoading('載入資料中...');
    try {
        setData(await fetchJsonWithRetry(API_URL + '?action=getData', '載入資料中...'));
        renderAll();
    } catch (e) {
        console.error('載入失敗:', e);
        error = e;
    } finally {
        hideLoading();
    }
    if (error && (await confirmBox('讀取資料失敗\n\n' + error.message + '\n\n要再試一次嗎？', '再試一次'))) loadData();
}

// ACTIONS 收 (data-id, 元素, 事件)；INPUTS 收 (元素)
function onClick(ev) {
    const el = ev.target.closest('[data-act]');
    const fn = el && ACTIONS[el.dataset.act];
    if (fn) fn(el.dataset.id, el, ev);
}
function onInput(attr) {
    return ev => {
        const el = ev.target.closest('[' + attr + ']');
        const fn = el && INPUTS[el.getAttribute(attr)];
        if (fn) fn(el);
    };
}

function bindEvents() {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput('data-input'));
    document.addEventListener('change', onInput('data-change'));

    // 表單送出：統一擋掉預設送出，並在等待伺服器時鎖住按鈕避免重複送出
    document.addEventListener('submit', async ev => {
        const form = ev.target.closest('form[data-form]');
        if (!form) return;
        ev.preventDefault();
        const fn = FORMS[form.dataset.form];
        const btn = form.querySelector('[type=submit]');
        if (!fn || (btn && btn.disabled)) return;
        if (btn) btn.disabled = true;
        try {
            await fn(form);
        } finally {
            if (btn) btn.disabled = false;
        }
    });

    document.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' && isModalOpen() && !$('dialog').classList.contains('show')) closeModal();
    });
    window.addEventListener('hashchange', () => switchTab(location.hash.slice(1)));
}

function init() {
    bindEvents();
    switchTab(location.hash.slice(1));
    renderAll();
    if (!API_URL) {
        const notice = $('config-notice');
        notice.textContent = '尚未設定後端網址：請依「部署說明.txt」部署 Apps Script，再把 /exec 網址填入 js/config.js 的 PROD_API_URL。';
        notice.classList.remove('hidden');
        return;
    }
    loadData();
}

init();

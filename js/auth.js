// 會員制：登入／註冊／登出／修改密碼／使用者管理（僅一級管理者）

let session = loadSession();   // { token, username, role } 或 null

function loadSession() {
    try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        return s && s.token && s.username ? s : null;
    } catch (e) {
        return null;
    }
}
function saveSession(s) {
    session = s;
    try {
        if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
        else localStorage.removeItem(SESSION_KEY);
    } catch (e) {
        // 無痕模式或封鎖網站資料時存不了，只影響「關掉重開仍記得登入」
    }
}

function isAuthed() { return !!session; }
function isAdmin() { return isAuthed() && session.role === 'admin'; }
function isManager() { return isAuthed() && (session.role === 'admin' || session.role === 'admin2'); }
function canEdit(ownerId) { return isManager() || (isAuthed() && String(ownerId) === String(session.username)); }
function roleLabel(r) { return r === 'admin' ? '一級管理者' : r === 'admin2' ? '二級管理者' : '會員'; }

function requireLogin(what) {
    if (isAuthed()) return true;
    notify('請先登入才能' + what + '。').then(() => openAuthModal('login'));
    return false;
}

// 後端回報 token 失效（改過密碼、被重置密碼）：清掉登入狀態
function onAuthExpired() {
    saveSession(null);
    renderAll();
}

function renderAuthUI() {
    const area = $('auth-area');
    if (!isAuthed()) {
        area.innerHTML = '<button class="btn btn-primary" data-act="auth-open" data-id="login">登入 / 註冊</button>';
    } else {
        area.innerHTML = `
            <span class="user-chip">你好，<b>${esc(session.username)}</b><span class="role-badge role-${esc(session.role)}">${esc(roleLabel(session.role))}</span></span>
            <button class="btn btn-ghost btn-sm" data-act="password-open">修改密碼</button>
            ${isAdmin() ? '<button class="btn btn-ghost btn-sm" data-act="users-open">使用者管理</button>' : ''}
            <button class="btn btn-ghost btn-sm" data-act="logout">登出</button>`;
    }
    $('guild-panel').classList.toggle('hidden', !isManager());
}

function openAuthModal(mode) {
    const isReg = mode === 'register';
    openModal(`
        <div class="modal-header">
            <div class="modal-subtitle">${isReg ? '需要公會註冊碼（向管理員索取）' : '歡迎回到夢幻島'}</div>
            <div class="modal-title">${isReg ? '註冊帳號' : '登入'}</div>
        </div>
        <form class="stack-form" data-form="${isReg ? 'register' : 'login'}">
            <input type="text" name="username" placeholder="帳號${isReg ? '（2～20 字）' : ''}" required maxlength="20" autocomplete="username">
            <input type="password" name="password" placeholder="密碼${isReg ? '（至少 6 碼）' : ''}" required maxlength="64" autocomplete="${isReg ? 'new-password' : 'current-password'}">
            ${isReg ? '<input type="text" name="registerCode" placeholder="註冊碼" required autocomplete="off">' : ''}
            <button type="submit" class="btn btn-save btn-block">${isReg ? '註冊並登入' : '登入'}</button>
        </form>
        <div class="auth-switch">
            ${isReg
                ? '已經有帳號？<button type="button" class="link" data-act="auth-open" data-id="login">登入</button>'
                : '還沒有帳號？<button type="button" class="link" data-act="auth-open" data-id="register">註冊</button>'}
        </div>`);
}

function applyAuth(r) {
    saveSession({ token: r.token, username: r.username, role: r.role });
    closeModal();
    renderAll();
}

ACTIONS['auth-open'] = mode => openAuthModal(mode);

FORMS.login = async form => {
    const v = formValues(form);
    const r = await apiCall({ action: 'login', username: v.username.trim(), password: v.password }, '登入失敗');
    if (r) applyAuth(r);
};

FORMS.register = async form => {
    const v = formValues(form);
    if (v.password.length < 6) return notify('密碼至少 6 碼。');
    const r = await apiCall({ action: 'register', username: v.username.trim(), password: v.password, registerCode: v.registerCode.trim() }, '註冊失敗');
    if (r) {
        applyAuth(r);
        notify('註冊成功，已自動登入！');
    }
};

ACTIONS.logout = async () => {
    if (!(await confirmBox('確定要登出嗎？'))) return;
    saveSession(null);
    renderAll();
};

// ---------- 修改密碼（所有登入者） ----------

ACTIONS['password-open'] = () => openModal(`
    <div class="modal-header"><div class="modal-subtitle">帳號設定</div><div class="modal-title">修改密碼</div></div>
    <form class="stack-form" data-form="password">
        <input type="password" name="oldPassword" placeholder="目前密碼" required autocomplete="current-password">
        <input type="password" name="newPassword" placeholder="新密碼（至少 6 碼）" required maxlength="64" autocomplete="new-password">
        <input type="password" name="newPassword2" placeholder="再次輸入新密碼" required maxlength="64" autocomplete="new-password">
        <button type="submit" class="btn btn-save btn-block">確認修改</button>
    </form>`);

FORMS.password = async form => {
    const v = formValues(form);
    if (v.newPassword.length < 6) return notify('新密碼至少 6 碼。');
    if (v.newPassword !== v.newPassword2) return notify('兩次輸入的新密碼不一致。');
    if (v.newPassword === v.oldPassword) return notify('新密碼不可與目前密碼相同。');
    const r = await apiCall({ action: 'changePassword', oldPassword: v.oldPassword, newPassword: v.newPassword }, '修改失敗');
    if (r) {
        saveSession(Object.assign({}, session, { token: r.token }));
        closeModal();
        notify('密碼已更新。其他裝置需要用新密碼重新登入。');
    }
};

// ---------- 使用者管理（僅一級管理者） ----------

const ROLE_ORDER = { admin: 0, admin2: 1, user: 2 };

ACTIONS['users-open'] = async () => {
    const r = await apiCall({ action: 'listUsers' }, '讀取帳號失敗');
    if (r) renderUsersModal(r.users || []);
};

function userRowHtml(u) {
    let btns = '<span class="muted">本人</span>';
    if (u.username !== session.username && u.role !== 'admin') {
        const toRole = u.role === 'admin2' ? 'user' : 'admin2';
        btns = `
            <button class="btn btn-ghost btn-sm" data-act="user-role" data-id="${esc(u.username)}" data-role="${toRole}">${u.role === 'admin2' ? '降為會員' : '設為二級管理者'}</button>
            <button class="btn btn-danger btn-sm" data-act="user-reset" data-id="${esc(u.username)}">重置密碼</button>`;
    } else if (u.username !== session.username) {
        btns = '';
    }
    return `<div class="user-row">
        <div><b>${esc(u.username)}</b><span class="role-badge role-${esc(u.role)}">${esc(roleLabel(u.role))}</span></div>
        <div class="btns">${btns}</div>
    </div>`;
}

function renderUsersModal(users) {
    const sorted = users.slice().sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || byText(a.username, b.username));
    openModal(`
        <div class="modal-header"><div class="modal-subtitle">一級管理者專用</div><div class="modal-title">使用者管理</div></div>
        <div class="section-title">建立二級管理者（可維護全部資料與公會，不能管帳號）</div>
        <form class="stack-form" data-form="create-manager">
            <input type="text" name="username" placeholder="帳號（2～20 字）" required maxlength="20" autocomplete="off">
            <input type="password" name="password" placeholder="預設密碼（至少 6 碼）" required maxlength="64" autocomplete="new-password">
            <button type="submit" class="btn btn-save btn-block">建立二級管理者</button>
        </form>
        <div class="section-title">所有帳號（${users.length}）</div>
        <div class="user-list">${sorted.map(userRowHtml).join('') || '<div class="user-row muted">尚無帳號</div>'}</div>`);
}

FORMS['create-manager'] = async form => {
    const v = formValues(form);
    if (v.password.length < 6) return notify('密碼至少 6 碼。');
    const r = await apiCall({ action: 'createManager', username: v.username.trim(), password: v.password }, '建立失敗');
    if (r) {
        await notify('已建立二級管理者：' + r.username);
        ACTIONS['users-open']();
    }
};

ACTIONS['user-role'] = async (username, el) => {
    const role = el.dataset.role;
    const msg = role === 'admin2' ? `確定把「${username}」設為二級管理者？\n二級管理者可修改、刪除所有人的資料。` : `確定把「${username}」降為一般會員？`;
    if (!(await confirmBox(msg))) return;
    if (await apiCall({ action: 'setRole', username, role }, '變更失敗')) ACTIONS['users-open']();
};

ACTIONS['user-reset'] = async username => {
    if (!(await confirmBox(`確定要重置「${username}」的密碼嗎？\n對方目前的登入會失效。`, '重置'))) return;
    const r = await apiCall({ action: 'resetPassword', username }, '重置失敗');
    if (r) notify(`已將「${username}」的密碼重置為：${r.resetTo}\n請通知本人登入後立即修改密碼。`);
};

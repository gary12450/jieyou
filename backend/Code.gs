/**
 * 解憂夢幻島 公會網站 — 後端 Apps Script（綁定 Google 試算表）
 * ============================================================
 * 參考「花非花 v2」後端改寫；花朵圖鑑改成通用「圖鑑（items）」，可收錄食靈、時裝、作物、料理…等任何類別。
 *
 * 安全模型：
 *   - 讀取（getData）公開；users 帳號表「絕不」透過 API 回傳。
 *   - 寫入需登入（token）。members / items / competitions：會員可新增，只能改／刪自己建立的；
 *     管理員（一級 admin、二級 admin2）可動全部。
 *   - 公會、批次設定「誰擁有」：僅管理員。帳號管理：僅一級管理者。
 *   - 密碼 SHA-256 + 隨機鹽，不存明文；同一帳號 10 分鐘內登入失敗 8 次會暫停登入。
 *   - 所有文字一律以「純文字」寫入（前綴 '），避免公式注入，也避免 Sheets 把遊戲ID、日期、鹽值自動轉成數字。
 *   - 所有寫入都在 LockService 鎖內執行，避免多人同時寫入互相覆蓋。
 *
 * 稽核與軟刪除：
 *   - 每列有 ownerId / createdAt / updatedAt / updatedBy / deletedAt / deletedBy。
 *   - 刪除＝寫入 deletedAt / deletedBy（不真的刪列），getData 會略過；救回＝到試算表清空該列 deletedAt。
 *
 * 部署步驟見專案根目錄「部署說明.txt」。
 * ※ 改過程式要「管理部署作業 → 編輯 → 版本：新版本」才會生效。
 * ============================================================
 */

const AUDIT = ['ownerId', 'createdAt', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy'];

// 各資料表可由前端寫入的欄位：max＝字數上限、req＝必填、list＝id 陣列（以 JSON 字串存放）
const FIELDS = {
  members: [
    { k: 'gameName', max: 30, req: true },
    { k: 'gameId', max: 30, req: true },
    { k: 'guild', max: 30 },
    { k: 'islandLevel', max: 10 },
    { k: 'ownedItems', list: true },
    { k: 'note', max: 200 }
  ],
  items: [
    { k: 'category', max: 10, req: true },
    { k: 'name', max: 40, req: true },
    { k: 'rarity', max: 20 },
    { k: 'unlockLevel', max: 10 },
    { k: 'source', max: 40 },
    { k: 'releaseDate', max: 20 },
    { k: 'note', max: 300 }
  ],
  competitions: [
    { k: 'period', max: 30, req: true },
    { k: 'memberId', max: 20, req: true },
    { k: 'selectedItems', list: true },
    { k: 'score', max: 20 },
    { k: 'note', max: 200 }
  ]
};

const LABELS = {
  gameName: '遊戲名稱', gameId: '遊戲ID', guild: '公會', islandLevel: '島嶼等級', note: '備註',
  category: '類別', name: '名稱', rarity: '稀有度', unlockLevel: '解鎖等級', source: '來源',
  releaseDate: '上市日期', period: '期別', memberId: '成員', score: '分數', ownedItems: '擁有項目',
  selectedItems: '參賽項目'
};

const COLS = {
  members: ['id'].concat(FIELDS.members.map(function (f) { return f.k; }), AUDIT),
  items: ['id'].concat(FIELDS.items.map(function (f) { return f.k; }), AUDIT),
  competitions: ['id'].concat(FIELDS.competitions.map(function (f) { return f.k; }), AUDIT),
  guilds: ['guild'].concat(AUDIT),
  users: ['username', 'passwordHash', 'salt', 'role', 'token', 'createdAt']
};

const LIST_MAX = 2000;            // 一個成員最多可勾選的項目數
const GUILD_NAME_MAX = 30;
const LOCK_WAIT_MS = 20000;       // 搶寫入鎖最多等 20 秒
const LOGIN_MAX_FAILS = 8;        // 同帳號連續登入失敗上限
const LOGIN_LOCK_SECONDS = 600;   // 超過上限後暫停 10 分鐘
const REGISTER_MAX_FAILS = 20;    // 全站註冊碼錯誤上限（10 分鐘內），超過暫停註冊，避免被暴力猜註冊碼
const USERNAME_RE = /^[\p{L}\p{N}_.-]{2,20}$/u;

// 預建圖鑑資料（seedItems 會寫入尚未存在的項目）。
// 來源：陸版《解忧梦幻岛》App Store 更新紀錄（2026-06～09），台版名稱與日期可能不同，請玩家自行校正。
const SEED_ITEMS = [
  { category: '食靈', name: '秋分桂影', source: '版本更新', note: '陸版 1.1.40（2026-09-11）新增；台版上市日期待確認' },
  { category: '食靈', name: '稻花靈鯉', source: '活動', note: '陸版 1.1.15（2026-07-20）新增「稻花靈鯉」活動；台版日期待確認' },
  { category: '時裝', name: '綺幻星語', source: '版本更新', note: '陸版 1.1.40（2026-09-11）新增；台版上市日期待確認' },
  { category: '時裝', name: '淺雪織冬', source: '時裝禮包', note: '陸版 1.1.55 限時禮包（2026-09-28～10-11）；台版日期待確認' },
  { category: '作物', name: '紫蘇', source: '版本更新', note: '陸版 1.1.12（2026-07-05）新增；台版上市日期待確認' },
  { category: '食材', name: '陽江黑豆', source: '商店', note: '陸版 1.1.15（2026-07-20）商店上新；台版日期待確認' }
];

// ---------- 共用 ----------

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw new Error('找不到分頁：' + name + '（請先執行 setup）');
  return s;
}
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function fail_(msg) { return { success: false, error: msg }; }
function now_() { return new Date().toISOString(); }
function hasValue_(v) { return v !== '' && v !== null && v !== undefined; }
function own_(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); } // 避免 '__proto__'、'constructor' 之類的 key 走到原型鏈

// 以純文字寫入儲存格：前綴 ' 讓 Sheets 不解讀成公式／數字／日期（讀回時不含這個 '）
function text_(v) { return hasValue_(v) ? "'" + String(v) : ''; }

// 讀回儲存格成字串；有人手動在試算表輸入日期時，統一轉成 yyyy-MM-dd
function str_(v) {
  if (!hasValue_(v)) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

function parseList_(v) {
  if (Array.isArray(v)) return v.map(String);
  const s = str_(v).trim();
  if (s === '') return [];
  if (s.charAt(0) === '[') {
    try { return JSON.parse(s).map(String); } catch (e) { /* 壞掉的 JSON 改用逗號拆 */ }
  }
  return s.split(',').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
}

// ---------- 讀取 ----------

// 回傳分頁內所有非空白列：[{ row: 試算表列號, o: {欄位: 值} }]
function rows_(name) {
  const values = sheet_(name).getDataRange().getValues();
  const cols = COLS[name];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r.every(function (c) { return c === '' || c === null; })) continue;
    const o = {};
    cols.forEach(function (c, idx) { o[c] = r[idx] === undefined ? '' : r[idx]; });
    out.push({ row: i + 1, o: o });
  }
  return out;
}
function alive_(name) { return rows_(name).filter(function (x) { return !hasValue_(x.o.deletedAt); }); }
function findAlive_(name, id) {
  return alive_(name).find(function (x) { return String(x.o.id) === String(id); }) || null;
}

function toPublic_(type, o) {
  const out = { id: String(o.id) };
  FIELDS[type].forEach(function (f) { out[f.k] = f.list ? parseList_(o[f.k]) : str_(o[f.k]); });
  out.ownerId = str_(o.ownerId);
  out.updatedAt = str_(o.updatedAt);
  out.updatedBy = str_(o.updatedBy);
  return out;
}

function getData_() {
  const data = {};
  ['members', 'items', 'competitions'].forEach(function (t) {
    data[t] = alive_(t).map(function (x) { return toPublic_(t, x.o); });
  });
  data.guilds = alive_('guilds').map(function (x) { return str_(x.o.guild); }).filter(hasValue_);
  return data;
}

// ---------- 帳號 / 驗證 ----------

function hash_(password, salt) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password + ':' + salt, Utilities.Charset.UTF_8);
  return raw.map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); }).join('');
}
function genToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}
function findUser_(username) {
  return rows_('users').find(function (x) { return String(x.o.username) === String(username); }) || null;
}
function userByToken_(token) {
  if (!token) return null;
  const u = rows_('users').find(function (x) { return hasValue_(x.o.token) && String(x.o.token) === String(token); });
  return u ? { username: String(u.o.username), role: String(u.o.role) } : null;
}
function isManager_(role) { return role === 'admin' || role === 'admin2'; }
function canEdit_(user, o) { return isManager_(user.role) || String(o.ownerId) === String(user.username); }
function setCell_(name, row, col, value) {
  sheet_(name).getRange(row, COLS[name].indexOf(col) + 1).setValue(value);
}
function checkPassword_(password) {
  if (password.length < 6) return '密碼至少 6 碼';
  if (password.length > 64) return '密碼最多 64 碼';
  return '';
}
function newUserRow_(username, password, role, token) {
  const salt = genToken_().slice(0, 16);
  return [text_(username), text_(hash_(password, salt)), text_(salt), text_(role), text_(token), text_(now_())];
}

function register_(body) {
  const code = prop_('REGISTER_CODE');
  if (!code) return fail_('網站尚未開放註冊（管理員尚未設定註冊碼）');
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!USERNAME_RE.test(username)) return fail_('帳號需 2～20 字，可用中英文、數字與 _ . -');
  const pwErr = checkPassword_(password);
  if (pwErr) return fail_(pwErr);
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('registerfail') || 0);
  if (fails >= REGISTER_MAX_FAILS) return fail_('註冊碼錯誤次數過多，請 10 分鐘後再試');
  if (String(body.registerCode || '').trim() !== code) {
    cache.put('registerfail', String(fails + 1), LOGIN_LOCK_SECONDS);
    return fail_('註冊碼錯誤');
  }
  if (findUser_(username)) return fail_('帳號已存在');
  const token = genToken_();
  sheet_('users').appendRow(newUserRow_(username, password, 'user', token));
  return { success: true, token: token, role: 'user', username: username };
}

function login_(body) {
  const username = String(body.username || '').trim();
  if (!USERNAME_RE.test(username)) return fail_('帳號或密碼錯誤'); // 也避免超長帳號撐爆 CacheService 的 key 長度上限
  const cache = CacheService.getScriptCache();
  const failKey = 'loginfail:' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= LOGIN_MAX_FAILS) return fail_('登入失敗次數過多，請 10 分鐘後再試');

  const u = findUser_(username);
  if (!u || hash_(String(body.password || ''), str_(u.o.salt)) !== str_(u.o.passwordHash)) {
    cache.put(failKey, String(fails + 1), LOGIN_LOCK_SECONDS);
    return fail_('帳號或密碼錯誤');
  }
  cache.remove(failKey);
  // 沿用既有 token，讓手機、電腦可同時登入；改密碼時才換新 token
  let token = str_(u.o.token);
  if (!token) {
    token = genToken_();
    setCell_('users', u.row, 'token', text_(token));
  }
  return { success: true, token: token, role: str_(u.o.role), username: username };
}

// 登入者修改自己的密碼：驗證原密碼，成功後換發新 token（其他裝置需重新登入）
function changePassword_(body, user) {
  const newPassword = String(body.newPassword || '');
  const pwErr = checkPassword_(newPassword);
  if (pwErr) return fail_(pwErr);
  const u = findUser_(user.username);
  if (!u) return fail_('找不到帳號');
  if (hash_(String(body.oldPassword || ''), str_(u.o.salt)) !== str_(u.o.passwordHash)) return fail_('原密碼錯誤');
  const salt = genToken_().slice(0, 16);
  const token = genToken_();
  setCell_('users', u.row, 'passwordHash', text_(hash_(newPassword, salt)));
  setCell_('users', u.row, 'salt', text_(salt));
  setCell_('users', u.row, 'token', text_(token));
  return { success: true, token: token };
}

// 一級管理者建立二級管理者
function createManager_(body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!USERNAME_RE.test(username)) return fail_('帳號需 2～20 字，可用中英文、數字與 _ . -');
  const pwErr = checkPassword_(password);
  if (pwErr) return fail_(pwErr);
  if (findUser_(username)) return fail_('帳號已存在');
  sheet_('users').appendRow(newUserRow_(username, password, 'admin2', ''));
  return { success: true, username: username, role: 'admin2' };
}

// 一級管理者重置他人密碼為隨機臨時密碼（只回傳給管理員），並清掉 token 強制重新登入。
// 不用固定預設密碼：原始碼放在公開的 GitHub，固定值等於公開。
function resetPassword_(body, user) {
  const target = String(body.username || '').trim();
  if (target === user.username) return fail_('不能重置自己的密碼，請用「修改密碼」');
  const u = findUser_(target);
  if (!u) return fail_('找不到該帳號');
  const resetTo = genToken_().slice(0, 10);
  const salt = genToken_().slice(0, 16);
  setCell_('users', u.row, 'passwordHash', text_(hash_(resetTo, salt)));
  setCell_('users', u.row, 'salt', text_(salt));
  setCell_('users', u.row, 'token', '');
  return { success: true, resetTo: resetTo };
}

// 一級管理者把會員升為二級管理者，或把二級降回會員
function setRole_(body, user) {
  const target = String(body.username || '').trim();
  const role = String(body.role || '');
  if (role !== 'user' && role !== 'admin2') return fail_('角色只能是會員或二級管理者');
  if (target === user.username) return fail_('不能變更自己的角色');
  const u = findUser_(target);
  if (!u) return fail_('找不到該帳號');
  if (str_(u.o.role) === 'admin') return fail_('不能變更一級管理者的角色');
  setCell_('users', u.row, 'role', text_(role));
  return { success: true };
}

function listUsers_() {
  const users = rows_('users').map(function (x) {
    return { username: str_(x.o.username), role: str_(x.o.role), createdAt: str_(x.o.createdAt) };
  });
  return { success: true, users: users };
}

// ---------- 寫入：members / items / competitions ----------

function clean_(type, item) {
  const values = {};
  for (let i = 0; i < FIELDS[type].length; i++) {
    const f = FIELDS[type][i];
    const raw = item ? item[f.k] : undefined;
    if (f.list) {
      const ids = parseList_(raw === undefined || raw === null ? [] : raw)
        .map(function (v) { return String(v).trim(); })
        .filter(function (v, idx, arr) { return v !== '' && arr.indexOf(v) === idx; });
      if (ids.length > LIST_MAX) return { error: LABELS[f.k] + '最多 ' + LIST_MAX + ' 項' };
      values[f.k] = ids;
    } else {
      const v = raw === undefined || raw === null ? '' : String(raw).trim();
      if (f.req && v === '') return { error: LABELS[f.k] + '必填' };
      if (v.length > f.max) return { error: LABELS[f.k] + '最多 ' + f.max + ' 字' };
      values[f.k] = v;
    }
  }
  return { values: values };
}

// 檢查重複與關聯；回傳錯誤訊息，沒問題回傳空字串
function conflict_(type, v, selfId) {
  const others = function (name) {
    return alive_(name).filter(function (x) { return String(x.o.id) !== String(selfId); });
  };
  if (type === 'members') {
    const dup = others('members').find(function (x) { return str_(x.o.gameId).toLowerCase() === v.gameId.toLowerCase(); });
    if (dup) return '遊戲ID「' + v.gameId + '」已登記過（成員：' + str_(dup.o.gameName) + '）';
    if (v.guild && !alive_('guilds').some(function (x) { return str_(x.o.guild) === v.guild; })) return '公會「' + v.guild + '」不存在';
  }
  if (type === 'items') {
    const dup = others('items').find(function (x) { return str_(x.o.category) === v.category && str_(x.o.name) === v.name; });
    if (dup) return '圖鑑已有「' + v.category + '／' + v.name + '」';
  }
  if (type === 'competitions') {
    if (!findAlive_('members', v.memberId)) return '找不到該成員（可能已被刪除）';
  }
  return '';
}

function buildRow_(type, id, values, audit) {
  return COLS[type].map(function (c) {
    if (c === 'id') return id;
    if (Object.prototype.hasOwnProperty.call(values, c)) {
      const v = values[c];
      return Array.isArray(v) ? text_(JSON.stringify(v)) : text_(v);
    }
    return text_(audit[c]);
  });
}

// 產生不重複的 id（在寫入鎖內呼叫）
function newId_() {
  const props = PropertiesService.getScriptProperties();
  const id = Math.max(Date.now(), Number(props.getProperty('LAST_ID') || 0) + 1);
  props.setProperty('LAST_ID', String(id));
  return id;
}

function addItem_(body, user) {
  const type = body.type;
  if (!own_(FIELDS, type)) return fail_('unknown type');
  const c = clean_(type, body.item);
  if (c.error) return fail_(c.error);
  const conflict = conflict_(type, c.values, null);
  if (conflict) return fail_(conflict);
  const id = newId_();
  const ts = now_();
  const audit = { ownerId: user.username, createdAt: ts, updatedAt: ts, updatedBy: user.username, deletedAt: '', deletedBy: '' };
  sheet_(type).appendRow(buildRow_(type, id, c.values, audit));
  return { success: true, record: toPublic_(type, Object.assign({ id: id }, c.values, audit)) };
}

function updateItem_(body, user) {
  const type = body.type;
  if (!own_(FIELDS, type)) return fail_('unknown type');
  const found = findAlive_(type, body.id);
  if (!found) return fail_('找不到資料（可能已被刪除）');
  if (!canEdit_(user, found.o)) return fail_('只能修改自己建立的資料');
  const c = clean_(type, body.item);
  if (c.error) return fail_(c.error);
  const conflict = conflict_(type, c.values, found.o.id);
  if (conflict) return fail_(conflict);
  const ts = now_();
  const audit = { ownerId: str_(found.o.ownerId), createdAt: str_(found.o.createdAt) || ts, updatedAt: ts, updatedBy: user.username, deletedAt: '', deletedBy: '' };
  const row = buildRow_(type, found.o.id, c.values, audit);
  sheet_(type).getRange(found.row, 1, 1, row.length).setValues([row]);
  return { success: true, record: toPublic_(type, Object.assign({ id: found.o.id }, c.values, audit)) };
}

function deleteItem_(body, user) {
  const type = body.type;
  if (!own_(FIELDS, type)) return fail_('unknown type');
  const found = findAlive_(type, body.id);
  if (!found) return fail_('找不到資料（可能已被刪除）');
  if (!canEdit_(user, found.o)) return fail_('只能刪除自己建立的資料');
  setCell_(type, found.row, 'deletedAt', text_(now_()));
  setCell_(type, found.row, 'deletedBy', text_(user.username));
  return { success: true };
}

// 管理員：一次設定某個圖鑑項目由哪些成員擁有。
// 前端只送「這次有變動的」成員（add／remove），沒列到的成員維持現狀，
// 避免管理員畫面較舊時，把別人剛勾的擁有狀態蓋掉。
function setItemOwners_(body, user) {
  const itemId = String(body.itemId || '');
  if (!findAlive_('items', itemId)) return fail_('找不到該圖鑑項目');
  const toSet = function (arr) {
    const s = {};
    (Array.isArray(arr) ? arr : []).forEach(function (id) { s[String(id)] = true; });
    return s;
  };
  const add = toSet(body.add);
  const remove = toSet(body.remove);
  const ts = now_();
  const all = rows_('members');
  const changed = [];
  const next = all.map(function (x) {
    const owned = parseList_(x.o.ownedItems);
    const id = String(x.o.id);
    if (hasValue_(x.o.deletedAt)) return null;
    const has = owned.indexOf(itemId) >= 0;
    let list = null;
    if (own_(add, id) && !has && owned.length < LIST_MAX) list = owned.concat([itemId]);
    if (own_(remove, id) && has) list = owned.filter(function (v) { return v !== itemId; });
    if (!list) return null;
    const o = Object.assign({}, x.o, { ownedItems: list, updatedAt: ts, updatedBy: user.username });
    changed.push(toPublic_('members', o));
    return o;
  });
  if (!changed.length) return { success: true, members: [] };

  // 整欄一次寫回（ownedItems、updatedAt、updatedBy 各一次），不逐格呼叫，成員多時才不會逾時。
  // 未變動的列寫回原值；全部經 text_()，避免 Sheets 重新解讀內容。
  const sh = sheet_('members');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { success: true, members: [] };
  ['ownedItems', 'updatedAt', 'updatedBy'].forEach(function (col) {
    const colIdx = COLS.members.indexOf(col) + 1;
    const values = sh.getRange(2, colIdx, lastRow - 1, 1).getValues();
    all.forEach(function (x, i) {
      if (!next[i]) return;
      const v = next[i][col];
      values[x.row - 2][0] = Array.isArray(v) ? JSON.stringify(v) : v;
    });
    sh.getRange(2, colIdx, lastRow - 1, 1).setValues(values.map(function (r) { return [text_(str_(r[0]))]; }));
  });
  return { success: true, members: changed };
}

// ---------- 寫入：公會（僅管理員） ----------

function addGuild_(body, user) {
  const name = String(body.name || '').trim();
  if (!name) return fail_('請輸入公會名稱');
  if (name.length > GUILD_NAME_MAX) return fail_('公會名稱最多 ' + GUILD_NAME_MAX + ' 字');
  if (alive_('guilds').some(function (x) { return str_(x.o.guild) === name; })) return fail_('公會「' + name + '」已存在');
  const ts = now_();
  sheet_('guilds').appendRow(buildRow_('guilds', null, { guild: name },
    { ownerId: user.username, createdAt: ts, updatedAt: ts, updatedBy: user.username, deletedAt: '', deletedBy: '' }));
  return { success: true };
}

function deleteGuild_(body, user) {
  const name = String(body.name || '').trim();
  const found = alive_('guilds').find(function (x) { return str_(x.o.guild) === name; });
  if (!found) return fail_('找不到公會');
  setCell_('guilds', found.row, 'deletedAt', text_(now_()));
  setCell_('guilds', found.row, 'deletedBy', text_(user.username));
  return { success: true };
}

// ---------- HTTP ----------

// auth:false＝免登入；manager＝一、二級管理者；admin＝僅一級管理者
const ACTIONS = {
  register: { auth: false, fn: register_ },
  login: { auth: false, fn: login_ },
  addItem: { fn: addItem_ },
  updateItem: { fn: updateItem_ },
  deleteItem: { fn: deleteItem_ },
  changePassword: { fn: changePassword_ },
  setItemOwners: { manager: true, fn: setItemOwners_ },
  addGuild: { manager: true, fn: addGuild_ },
  deleteGuild: { manager: true, fn: deleteGuild_ },
  listUsers: { admin: true, fn: listUsers_ },
  createManager: { admin: true, fn: createManager_ },
  resetPassword: { admin: true, fn: resetPassword_ },
  setRole: { admin: true, fn: setRole_ }
};

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'getData') return json_(getData_());
    return json_({ error: 'unknown action' });
  } catch (err) { return json_({ error: String((err && err.message) || err) }); }
}

function doPost(e) {
  let lock = null;
  let locked = false;
  try {
    const body = JSON.parse(e.postData.contents);
    const a = own_(ACTIONS, body.action) ? ACTIONS[body.action] : null;
    if (!a) return json_(fail_('unknown action'));

    lock = LockService.getScriptLock();
    locked = lock.tryLock(LOCK_WAIT_MS);
    if (!locked) return json_(fail_('目前有其他人正在寫入，請稍後再試'));

    let user = null;
    if (a.auth !== false) {
      user = userByToken_(body.token);
      if (!user) return json_({ success: false, error: '尚未登入或登入已失效，請重新登入', authExpired: true });
      if (a.admin && user.role !== 'admin') return json_(fail_('權限不足：僅一級管理者可執行'));
      if (a.manager && !isManager_(user.role)) return json_(fail_('權限不足：僅管理員可執行'));
    }
    return json_(a.fn(body, user));
  } catch (err) {
    return json_(fail_(String((err && err.message) || err)));
  } finally {
    if (locked) lock.releaseLock();
  }
}

// ---------- 初始化（在 Apps Script 編輯器手動執行；可重複執行） ----------

function setup() {
  const ss = ss_();
  Object.keys(COLS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, COLS[name].length).setValues([COLS[name]]);
    sh.setFrozenRows(1);
  });
  const au = prop_('ADMIN_USERNAME');
  const ap = prop_('ADMIN_PASSWORD');
  if (au && !USERNAME_RE.test(au)) throw new Error('ADMIN_USERNAME 需 2～20 字，只能用中英文、數字與 _ . -');
  if (au && ap && !findUser_(au)) {
    sheet_('users').appendRow(newUserRow_(au, ap, 'admin', ''));
  }
  return 'setup 完成';
}

// 寫入預建圖鑑（已存在同類別同名稱的會略過）
function seedItems() {
  const owner = prop_('ADMIN_USERNAME') || 'admin';
  const ts = now_();
  const existing = alive_('items').map(function (x) { return str_(x.o.category) + '／' + str_(x.o.name); });
  let added = 0;
  SEED_ITEMS.forEach(function (s) {
    if (existing.indexOf(s.category + '／' + s.name) >= 0) return;
    const c = clean_('items', s);
    if (c.error) throw new Error(s.name + '：' + c.error);
    sheet_('items').appendRow(buildRow_('items', newId_(), c.values,
      { ownerId: owner, createdAt: ts, updatedAt: ts, updatedBy: owner, deletedAt: '', deletedBy: '' }));
    added++;
  });
  return 'seedItems 完成，新增 ' + added + ' 筆';
}

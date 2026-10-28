// backend/Code.gs 的自動測試（在記憶體裡跑，不碰 mock-db.json）
//   執行：node --test dev/backend.test.js
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');
const { createGasEnv } = require('./gas-shim');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8');

function boot() {
  const db = { sheets: {}, props: {} };
  const props = { REGISTER_CODE: 'test', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'test1234' };
  const gas = vm.createContext(createGasEnv(db, props));
  vm.runInContext(CODE, gas);
  gas.setup();
  gas.seedItems();
  const post = body => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(body) } }).content);
  const get = () => JSON.parse(gas.doGet({ parameter: { action: 'getData' } }).content);
  const login = (username, password) => post({ action: 'login', username, password }).token;
  const register = (username, password) => post({ action: 'register', username, password, registerCode: 'test' }).token;
  return { db, props, gas, post, get, login, register };
}

test('seedItems 寫入預建圖鑑，重複執行不會重複新增', () => {
  const t = boot();
  const n = t.get().items.length;
  assert.ok(n >= 6);
  t.gas.seedItems();
  assert.equal(t.get().items.length, n);
});

test('getData 不會回傳帳號資料', () => {
  const t = boot();
  const data = t.get();
  assert.deepEqual(Object.keys(data).sort(), ['competitions', 'guilds', 'items', 'members']);
  assert.ok(!JSON.stringify(data).includes('passwordHash'));
});

test('註冊需要正確註冊碼，帳號格式與密碼長度會檢查', () => {
  const t = boot();
  assert.equal(t.post({ action: 'register', username: 'test1', password: 'test1234', registerCode: 'wrong' }).error, '註冊碼錯誤');
  assert.match(t.post({ action: 'register', username: 'a', password: 'test1234', registerCode: 'test' }).error, /帳號需/);
  assert.match(t.post({ action: 'register', username: 'test1', password: '123', registerCode: 'test' }).error, /至少 6 碼/);
  assert.ok(t.register('測試一號', 'test1234'));
  assert.equal(t.post({ action: 'register', username: '測試一號', password: 'test1234', registerCode: 'test' }).error, '帳號已存在');
});

test('登入沿用既有 token（多裝置同時登入），改密碼後換新 token', () => {
  const t = boot();
  const first = t.register('test1', 'test1234');
  assert.equal(t.login('test1', 'test1234'), first);
  const r = t.post({ action: 'changePassword', token: first, oldPassword: 'test1234', newPassword: 'test5678' });
  assert.ok(r.success);
  assert.notEqual(r.token, first);
  assert.equal(t.post({ action: 'addGuild', token: first, name: 'x' }).authExpired, true);
  assert.equal(t.login('test1', 'test5678'), r.token);
});

test('連續登入失敗會暫停登入', () => {
  const t = boot();
  t.register('test1', 'test1234');
  for (let i = 0; i < 8; i++) t.post({ action: 'login', username: 'test1', password: 'bad' });
  assert.match(t.post({ action: 'login', username: 'test1', password: 'test1234' }).error, /次數過多/);
});

test('會員只能改刪自己建立的資料，管理員可動全部', () => {
  const t = boot();
  const admin = t.login('admin', 'test1234');
  const a = t.register('testA', 'test1234');
  const b = t.register('testB', 'test1234');
  t.post({ action: 'addGuild', token: admin, name: '測試公會' });

  const m = t.post({ action: 'addItem', token: a, type: 'members', item: { gameName: '測試甲', gameId: '1001', guild: '測試公會' } });
  assert.ok(m.success, m.error);
  const id = m.record.id;

  const byB = t.post({ action: 'updateItem', token: b, type: 'members', id, item: { gameName: '改名', gameId: '1001' } });
  assert.equal(byB.error, '只能修改自己建立的資料');
  assert.equal(t.post({ action: 'deleteItem', token: b, type: 'members', id }).error, '只能刪除自己建立的資料');

  const byAdmin = t.post({ action: 'updateItem', token: admin, type: 'members', id, item: { gameName: '管理員改', gameId: '1001' } });
  assert.ok(byAdmin.success);
  assert.equal(byAdmin.record.ownerId, 'testA');
  assert.equal(byAdmin.record.updatedBy, 'admin');
});

test('會員可新增圖鑑；同類別同名稱不可重複', () => {
  const t = boot();
  const a = t.register('testA', 'test1234');
  const r = t.post({ action: 'addItem', token: a, type: 'items', item: { category: '作物', name: '測試番茄' } });
  assert.ok(r.success, r.error);
  assert.match(t.post({ action: 'addItem', token: a, type: 'items', item: { category: '作物', name: '測試番茄' } }).error, /已有/);
  assert.ok(t.post({ action: 'addItem', token: a, type: 'items', item: { category: '料理', name: '測試番茄' } }).success);
});

test('遊戲ID 不可重複、公會必須存在', () => {
  const t = boot();
  const a = t.register('testA', 'test1234');
  assert.ok(t.post({ action: 'addItem', token: a, type: 'members', item: { gameName: '測試甲', gameId: 'ABC' } }).success);
  assert.match(t.post({ action: 'addItem', token: a, type: 'members', item: { gameName: '測試乙', gameId: 'abc' } }).error, /已登記/);
  assert.match(t.post({ action: 'addItem', token: a, type: 'members', item: { gameName: '測試乙', gameId: 'X2', guild: '不存在' } }).error, /不存在/);
});

test('文字原樣保存：前導 0、看起來像公式／日期／科學記號的內容都不會被 Sheets 轉換', () => {
  const t = boot();
  const a = t.register('testA', 'test1234');
  const item = { gameName: '=1+1', gameId: '000123', islandLevel: '1e5', note: '2026-10-01' };
  const r = t.post({ action: 'addItem', token: a, type: 'members', item });
  assert.ok(r.success, r.error);
  const saved = t.get().members.find(x => x.id === r.record.id);
  assert.equal(saved.gameName, '=1+1');
  assert.equal(saved.gameId, '000123');
  assert.equal(saved.islandLevel, '1e5');
  assert.equal(saved.note, '2026-10-01');
});

test('軟刪除：刪除後 getData 看不到，但列仍在試算表', () => {
  const t = boot();
  const a = t.register('testA', 'test1234');
  const r = t.post({ action: 'addItem', token: a, type: 'items', item: { category: '作物', name: '測試蘿蔔' } });
  const before = t.db.sheets.items.length;
  assert.ok(t.post({ action: 'deleteItem', token: a, type: 'items', id: r.record.id }).success);
  assert.equal(t.db.sheets.items.length, before);
  assert.ok(!t.get().items.some(x => x.id === r.record.id));
  assert.match(t.post({ action: 'deleteItem', token: a, type: 'items', id: r.record.id }).error, /找不到/);
});

test('競賽紀錄要對應存在的成員', () => {
  const t = boot();
  const a = t.register('testA', 'test1234');
  const m = t.post({ action: 'addItem', token: a, type: 'members', item: { gameName: '測試甲', gameId: '1' } });
  const itemId = t.get().items[0].id;
  const c = t.post({ action: 'addItem', token: a, type: 'competitions', item: { period: '2026年第44週', memberId: m.record.id, selectedItems: [itemId, itemId] } });
  assert.ok(c.success, c.error);
  assert.deepEqual(c.record.selectedItems, [itemId]);
  assert.match(t.post({ action: 'addItem', token: a, type: 'competitions', item: { period: 'x', memberId: '999' } }).error, /找不到該成員/);
});

test('setItemOwners：僅管理員，可一次設定誰擁有', () => {
  const t = boot();
  const admin = t.login('admin', 'test1234');
  const a = t.register('testA', 'test1234');
  const m1 = t.post({ action: 'addItem', token: a, type: 'members', item: { gameName: '測試甲', gameId: '1' } }).record;
  const m2 = t.post({ action: 'addItem', token: a, type: 'members', item: { gameName: '測試乙', gameId: '2' } }).record;
  const itemId = t.get().items[0].id;
  assert.match(t.post({ action: 'setItemOwners', token: a, itemId, add: [m1.id] }).error, /權限不足/);
  const r = t.post({ action: 'setItemOwners', token: admin, itemId, add: [m1.id, m2.id] });
  assert.equal(r.members.length, 2);
  assert.equal(r.members[0].updatedBy, 'admin');
  const r2 = t.post({ action: 'setItemOwners', token: admin, itemId, remove: [m1.id] });
  assert.deepEqual(r2.members.map(m => [m.id, m.ownedItems]), [[m1.id, []]]);
  const data = t.get();
  assert.deepEqual(data.members.find(x => x.id === m2.id).ownedItems, [itemId]);
  assert.equal(data.members.find(x => x.id === m1.id).gameId, '1');
});

test('setItemOwners：沒列在 add／remove 的成員不受影響（管理員畫面較舊也不會蓋掉）', () => {
  const t = boot();
  const admin = t.login('admin', 'test1234');
  const a = t.register('testA', 'test1234');
  const itemId = t.get().items[0].id;
  const m1 = t.post({ action: 'addItem', token: a, type: 'members', item: { gameName: '測試甲', gameId: '1' } }).record;
  // 管理員開畫面之後，testA 才自己新增一位擁有該項目的成員
  const late = t.post({ action: 'addItem', token: a, type: 'members', item: { gameName: '測試乙', gameId: '2', ownedItems: [itemId] } }).record;
  t.post({ action: 'setItemOwners', token: admin, itemId, add: [m1.id], remove: [] });
  const data = t.get();
  assert.deepEqual(data.members.find(x => x.id === late.id).ownedItems, [itemId]);
  assert.deepEqual(data.members.find(x => x.id === m1.id).ownedItems, [itemId]);
});

test('註冊碼猜錯太多次會暫停註冊', () => {
  const t = boot();
  for (let i = 0; i < 20; i++) t.post({ action: 'register', username: 'test' + i, password: 'test1234', registerCode: 'bad' });
  assert.match(t.post({ action: 'register', username: 'testOK', password: 'test1234', registerCode: 'test' }).error, /次數過多/);
});

test('不存在的 action／type（含原型鏈名稱）都會被拒絕', () => {
  const t = boot();
  const a = t.register('testA', 'test1234');
  assert.equal(t.post({ action: 'constructor', token: a }).error, 'unknown action');
  assert.equal(t.post({ action: 'addItem', token: a, type: '__proto__', item: {} }).error, 'unknown type');
  assert.equal(t.post({ action: 'addItem', token: a, type: 'users', item: {} }).error, 'unknown type');
});

test('帳號管理：僅一級管理者；可建二級、升降角色、重置密碼', () => {
  const t = boot();
  const admin = t.login('admin', 'test1234');
  const a = t.register('testA', 'test1234');
  assert.match(t.post({ action: 'listUsers', token: a }).error, /權限不足/);
  assert.ok(t.post({ action: 'createManager', token: admin, username: 'testM', password: 'test1234' }).success);
  assert.ok(t.post({ action: 'setRole', token: admin, username: 'testA', role: 'admin2' }).success);
  assert.equal(t.login('testA', 'test1234'), a);
  assert.ok(t.post({ action: 'addGuild', token: a, name: '二級建立' }).success);
  assert.match(t.post({ action: 'setRole', token: admin, username: 'admin', role: 'user' }).error, /自己/);
  const reset = t.post({ action: 'resetPassword', token: admin, username: 'testA' });
  assert.ok(reset.success);
  assert.equal(reset.resetTo.length, 10);
  assert.notEqual(t.post({ action: 'resetPassword', token: admin, username: 'testA' }).resetTo, reset.resetTo);
  const latest = t.post({ action: 'resetPassword', token: admin, username: 'testA' }).resetTo;
  assert.equal(t.post({ action: 'addGuild', token: a, name: 'y' }).authExpired, true);
  assert.ok(t.login('testA', latest));
  assert.equal(t.login('testA', reset.resetTo), undefined);
  const users = t.post({ action: 'listUsers', token: admin }).users;
  assert.ok(users.every(u => !('passwordHash' in u) && !('token' in u)));
});

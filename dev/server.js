// 本機測試伺服器：提供網站靜態檔，並把 /api 交給「真正的」backend/Code.gs 執行（試算表以 JSON 檔模擬）。
//   啟動：node dev/server.js            （預設埠 8140）
//   選項：--reset 清空模擬資料重來、--port=8140、--delay=800（模擬 Google 回應延遲，毫秒）
// 測試帳號與註冊碼在 dev/mock-config.json。
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { createGasEnv } = require('./gas-shim');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(__dirname, 'mock-db.json');
const CONFIG_FILE = path.join(__dirname, 'mock-config.json');
const CODE_FILE = path.join(ROOT, 'backend', 'Code.gs');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const PORT = Number(args.port || 8140);
const DELAY_MS = Number(args.delay || 0);

const STATIC_DIRS = ['css', 'js', 'assets'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8'
};

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

const config = loadJson(CONFIG_FILE, null);
if (!config) {
  console.error('找不到或無法解析 ' + CONFIG_FILE);
  process.exit(1);
}

const freshStart = args.reset || !fs.existsSync(DB_FILE);
const db = freshStart ? { sheets: {}, props: {} } : loadJson(DB_FILE, { sheets: {}, props: {} });
const props = Object.assign({}, db.props, config.scriptProperties);
db.props = props;

const gas = vm.createContext(createGasEnv(db, props));
vm.runInContext(fs.readFileSync(CODE_FILE, 'utf8'), gas, { filename: 'Code.gs' });

function save() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1), 'utf8'); }

if (freshStart) {
  console.log(gas.setup());
  console.log(gas.seedItems());
  save();
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.resolve(ROOT, rel);
  const top = path.relative(ROOT, file).split(path.sep)[0];
  const allowed = rel === 'index.html' || rel === 'dev/icon-preview.html' || STATIC_DIRS.includes(top);
  if (!allowed || !file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
  }
  send(res, 200, MIME[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  if (DELAY_MS) await new Promise(r => setTimeout(r, DELAY_MS));
  let out;
  if (req.method === 'GET') {
    out = gas.doGet({ parameter: Object.fromEntries(url.searchParams) });
  } else if (req.method === 'POST') {
    out = gas.doPost({ postData: { contents: await readBody(req) } });
    save();
  } else {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
  }
  send(res, 200, 'application/json; charset=utf-8', out.content);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const task = url.pathname === '/api' ? handleApi(req, res, url) : Promise.resolve(serveStatic(req, res, url.pathname));
  task.catch(err => {
    console.error(err);
    send(res, 500, 'text/plain; charset=utf-8', String(err));
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('解憂夢幻島 本機測試：http://localhost:' + PORT + '/');
});

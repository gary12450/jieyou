// 本機模擬 Google Apps Script 環境：讓 backend/Code.gs 不用改一行就能在 Node 執行。
// 只實作 Code.gs 用到的 API；試算表內容存在記憶體，由 server.js 負責讀寫 JSON 檔。
'use strict';

const crypto = require('crypto');

// 模擬 Sheets 的「使用者輸入」規則：前綴 ' 的字串存成純文字（去掉 '）；
// 沒有前綴、長得像數字的字串會被轉成數字——用來抓出忘了用 text_() 的寫入。
function toCellValue(v) {
  if (typeof v === 'string') {
    if (v.startsWith("'")) return v.slice(1);
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v.trim())) return Number(v);
    return v;
  }
  if (v === null || v === undefined) return '';
  return v;
}

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.rows[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some(r => r.length !== this.numCols)) {
      throw new Error('The number of rows or columns in the data does not match the range.');
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.put(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.put(this.row, this.col, v); return this; }
}

// rows 直接讀寫 db.sheets[name]，server.js 存檔時就是最新內容
class Sheet {
  constructor(db, name) { this.db = db; this.name = name; }
  get rows() { return this.db.sheets[this.name]; }
  set rows(v) { this.db.sheets[this.name] = v; }
  width() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  put(row, col, v) {
    while (this.rows.length < row) this.rows.push([]);
    const line = this.rows[row - 1];
    while (line.length < col) line.push('');
    line[col - 1] = toCellValue(v);
  }
  getLastRow() { return this.rows.length; }
  getDataRange() {
    return new Range(this, 1, 1, Math.max(1, this.rows.length), Math.max(1, this.width()));
  }
  getRange(row, col, numRows, numCols) { return new Range(this, row, col, numRows || 1, numCols || 1); }
  appendRow(values) { this.rows.push(values.map(toCellValue)); return this; }
  clear() { this.rows = []; return this; }
  setFrozenRows() { return this; }
}

function createGasEnv(db, props) {
  const spreadsheet = {
    getSheetByName: name => (db.sheets[name] ? new Sheet(db, name) : null),
    insertSheet(name) {
      db.sheets[name] = [];
      return new Sheet(db, name);
    }
  };

  const cache = new Map();
  return {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (Object.prototype.hasOwnProperty.call(props, k) ? String(props[k]) : null),
        setProperty: (k, v) => { props[k] = String(v); }
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: content => ({ content, setMimeType() { return this; } })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // GAS 回傳的是有號 byte（-128～127）
      computeDigest: (alg, str) => Array.from(crypto.createHash(alg).update(str, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.randomUUID(),
      formatDate: d => d.toISOString().slice(0, 10)
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    CacheService: {
      getScriptCache: () => ({
        get(k) {
          const e = cache.get(k);
          if (!e || e.exp < Date.now()) return null;
          return e.v;
        },
        put(k, v, sec) { cache.set(k, { v: String(v), exp: Date.now() + (sec || 600) * 1000 }); },
        remove(k) { cache.delete(k); }
      })
    },
    Logger: { log: (...a) => console.log('[Logger]', ...a) },
    console
  };
}

module.exports = { createGasEnv };

/**
 * Tandem — Google Sheets backend (Apps Script)
 * ---------------------------------------------------------------
 * 1. Open your Google Sheet -> Extensions -> Apps Script
 * 2. Replace everything in Code.gs with this file, press Save
 * 3. Choose the function "setup" in the toolbar and press Run (authorise when asked)
 * 4. Deploy -> New deployment -> Web app -> Execute as: Me, Who has access: Anyone
 * 5. Copy the Web app URL (ends in /exec) into the Tandem app
 */

var APP = 'Tandem';

var SCHEMA = {
  Users: ['id', 'name', 'email', 'color', 'salt', 'passHash', 'createdAt', 'quickKey', 'googleEmail'],
  Expenses: ['id', 'type', 'date', 'amount', 'description', 'category', 'paidBy', 'mode', 'cardId',
    'splitType', 'splitInfo', 'share1', 'share2', 'friendsShare', 'friends', 'platform', 'device', 'cats', 'accountId', 'upiApp', 'debitCardId', 'toAccountId', 'refundOf', 'trip', 'receipt', 'notes', 'recurringId', 'settledBy', 'createdBy', 'createdAt', 'updatedAt', 'deleted'],
  Cards: ['id', 'owner', 'name', 'last4', 'statementDay', 'dueDay', 'limit', 'rewards', 'deleted', 'updatedAt'],
  Recurring: ['id', 'description', 'amount', 'category', 'paidBy', 'mode', 'cardId', 'splitType',
    'payerPct', 'dayOfMonth', 'active', 'accountId', 'schedule', 'days', 'askTime', 'startDate', 'deleted', 'updatedAt'],
  Accounts: ['id', 'owner', 'name', 'last4', 'upiApp', 'debitCards', 'balance0', 'balance0At', 'deleted', 'updatedAt'],
  BillPayments: ['id', 'cardId', 'cycle', 'paidOn', 'paidBy', 'deleted', 'updatedAt'],
  Inbox: ['id', 'owner', 'at', 'sender', 'text', 'status', 'expenseId', 'updatedAt'],
  Settings: ['id', 'value', 'updatedAt']
};
var WRITABLE = { Expenses: 1, Cards: 1, Accounts: 1, Recurring: 1, BillPayments: 1, Settings: 1, Inbox: 1 };
var NUMERIC = { amount: '0.00', share1: '0.00', share2: '0.00', friendsShare: '0.00', createdAt: '0', updatedAt: '0', at: '0' };
var USER_COLORS = ['#2563eb', '#c026d3'];

/* ------------------------------------------------------------------ setup */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String) : [];
    SCHEMA[name].forEach(function (h) { if (cols.indexOf(h) < 0) cols.push(h); });
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    var rows = Math.max(sh.getMaxRows() - 1, 1);
    cols.forEach(function (h, i) {
      var fmt = '@';
      if (name === 'Expenses' && h === 'date') fmt = 'yyyy-mm-dd';
      else if (NUMERIC[h]) fmt = NUMERIC[h];
      sh.getRange(2, i + 1, rows, 1).setNumberFormat(fmt);
    });
  });
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  var users = ss.getSheetByName('Users');
  if (users && !users.isSheetHidden()) users.hideSheet();
  ss.setActiveSheet(ss.getSheetByName('Expenses'));

  secret_();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyReminders' || t.getHandlerFunction() === 'askNotify') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(9).create();
  ScriptApp.newTrigger('askNotify').timeBased().everyMinutes(15).create();
  // pick how many hashing rounds this account can do in about 0.6 s, so stored passwords are slow to guess
  var t0 = Date.now(); slowHash_('calibrate', 'calibrate', 300);
  PropertiesService.getScriptProperties().setProperty('HASH_ROUNDS', String(Math.max(1000, Math.min(50000, Math.round(600 * 300 / Math.max(Date.now() - t0, 1))))));
  Logger.log('Tandem is set up. Now: Deploy -> New deployment -> Web app.');
}

/* ------------------------------------------------------------------ http */

function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.sms) return ContentService.createTextOutput(locked_(function () { return sms_({ key: q.sms, text: q.text, from: q.from }); }));
  if (q.quick) {                       // one-tap links used by phone notifications and iPhone Shortcuts
    var msg, lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try { msg = quick_(q); } catch (err) { msg = 'Tandem: ' + String(err && err.message || err); } finally { lock.releaseLock(); }
    return ContentService.createTextOutput(msg);
  }
  return json_({ ok: true, app: APP, message: 'Tandem backend is running. Paste this URL into the app.' });
}

function doPost(e) {
  var q = (e && e.parameter) || {};
  if (q.sms) {                         // a forwarded bank SMS: ?sms=KEY with the text as a form field or as the raw body
    return ContentService.createTextOutput(locked_(function () {
      return sms_({ key: q.sms, text: q.text || (e.postData && !/^text=/.test(e.postData.contents || '') ? e.postData.contents : ''), from: q.from });
    }));
  }
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var lock = LockService.getScriptLock();
    lock.waitLock(25000);
    try { out = route_(req); } finally { lock.releaseLock(); }
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err), code: (err && err.code) || 'error' };
  }
  return json_(out);
}

function locked_(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); return fn(); } catch (err) { return 'Tandem: ' + String(err && err.message || err); } finally { try { lock.releaseLock(); } catch (e) {} }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(msg, code) { var e = new Error(msg); e.code = code || 'error'; return e; }

function route_(req) {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users')) {
    throw fail_('Backend not set up yet. Run the "setup" function in Apps Script first.', 'setup');
  }
  switch (req.action) {
    case 'status': return status_();
    case 'register': return register_(req);
    case 'login': return login_(req);
    case 'googleLogin': return googleLogin_(req);
    case 'resetRequest': return resetRequest_(req);
    case 'resetConfirm': return resetConfirm_(req);
  }
  var me = auth_(req.token);
  switch (req.action) {
    case 'sync': return sync_(me, req);
    case 'updateProfile': return updateProfile_(me, req);
    case 'testEmail': return testEmail_(me);
    case 'quickKey': return quickKey_(me, req);
    case 'linkGoogle': return linkGoogle_(me, req);
    case 'backup': return { ok: true, url: backup_() };
    case 'ntfyTest': return ntfyTest_(me, req);
    case 'receiptUp': return receiptUp_(me, req);
    case 'receiptGet': return receiptGet_(me, req);
    case 'receiptDel': return receiptDel_(me, req);
  }
  throw fail_('Unknown action');
}

/* ------------------------------------------------------------------ auth */

function secret_() {
  var p = PropertiesService.getScriptProperties();
  var s = p.getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRET', s); }
  return s;
}
function hash_(salt, pw) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pw, Utilities.Charset.UTF_8));
}
/* Passwords: salted, then HMAC-SHA256 repeated thousands of times ("v2$rounds$hash"). Older single-pass hashes are upgraded at the next sign-in. */
function slowHash_(salt, pw, rounds) {
  rounds = rounds || Number(PropertiesService.getScriptProperties().getProperty('HASH_ROUNDS')) || 3000;
  var key = Utilities.newBlob(String(pw)).getBytes(), h = Utilities.newBlob(String(salt)).getBytes();
  for (var i = 0; i < rounds; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return 'v2$' + rounds + '$' + Utilities.base64Encode(h);
}
function checkPw_(u, pw) {
  var cur = String(u.passHash || '');
  pw = String(pw || '');
  if (!pw || cur.indexOf('none$') === 0) return false;            // Google-only account: no password set
  if (cur.indexOf('v2$') === 0) return slowHash_(u.salt, pw, Number(cur.split('$')[1])) === cur;
  return hash_(u.salt, pw) === cur;
}
function sign_(str) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(str, secret_()));
}
function token_(u) {
  var exp = Date.now() + 180 * 864e5;
  return u.id + '.' + exp + '.' + sign_(u.id + '.' + exp + '.' + u.passHash);
}
function auth_(token) {
  var p = String(token || '').split('.');
  var u = p.length === 3 ? findUser_(p[0]) : null;
  if (!u || Number(p[1]) < Date.now() || sign_(p[0] + '.' + p[1] + '.' + u.passHash) !== p[2]) {
    throw fail_('Please sign in again.', 'auth');
  }
  return u;
}
function findUser_(id) {
  return read_('Users').filter(function (u) { return String(u.id) === String(id); })[0] || null;
}
function publicUsers_() {
  return read_('Users').map(function (u) { return { id: u.id, name: u.name, color: u.color }; });
}

function status_() {
  var users = publicUsers_();
  return { ok: true, app: APP, users: users, canRegister: users.length < 2, googleClientId: String(setting_('googleClientId', '') || '') };
}

function register_(req) {
  var users = read_('Users');
  if (users.length >= 2) throw fail_('Both accounts already exist. Sign in instead.');
  var name = String(req.name || '').trim().slice(0, 40);
  var pw = String(req.password || '');
  if (!name) throw fail_('Enter your name.');
  if (pw.length < 6) throw fail_('Password must be at least 6 characters.');
  var salt = Utilities.getUuid();
  var u = {
    id: 'u' + (users.length + 1), name: name, email: String(req.email || '').trim().slice(0, 120),
    color: USER_COLORS[users.length], salt: salt, passHash: slowHash_(salt, pw), createdAt: String(Date.now())
  };
  upsert_('Users', u);
  return { ok: true, token: token_(u), userId: u.id };
}

function login_(req) {
  var u = findUser_(req.userId);
  if (!u) throw fail_('Account not found.');
  var props = PropertiesService.getScriptProperties();
  var key = 'FAIL_' + u.id;
  var f = JSON.parse(props.getProperty(key) || '{"n":0,"until":0}');
  if (f.until > Date.now()) throw fail_('Too many attempts. Try again in ' + Math.ceil((f.until - Date.now()) / 60000) + ' min.');
  if (!checkPw_(u, req.password)) {
    f.n++;
    if (f.n >= 5) { f.until = Date.now() + 15 * 60000; f.n = 0; }
    props.setProperty(key, JSON.stringify(f));
    throw fail_('Wrong password.');
  }
  props.deleteProperty(key);
  if (String(u.passHash).indexOf('v2$') !== 0) {                    // upgrade an old hash now that we know the password
    u.passHash = slowHash_(u.salt, String(req.password));
    upsert_('Users', { id: u.id, passHash: u.passHash });
  }
  return { ok: true, token: token_(u), userId: u.id };
}

/* Forgotten password: a 6-digit code emailed to the address saved on the account. */
function resetRequest_(req) {
  var u = findUser_(req.userId);
  if (!u) throw fail_('Account not found.');
  if (!u.email) throw fail_('No email is saved on this account, so a code cannot be sent. Sign in with Google if you linked it; otherwise see "Forgot a password" in SETUP.md.');
  var props = PropertiesService.getScriptProperties(), key = 'RST_' + u.id, cur = JSON.parse(props.getProperty(key) || '{}');
  if (cur.sentAt && Date.now() - cur.sentAt < 2 * 60000) throw fail_('A code was sent a moment ago. Check your inbox, or try again in 2 minutes.');
  var code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 1000000);
  while (code.length < 6) code = '0' + code;
  props.setProperty(key, JSON.stringify({ h: sign_('reset|' + u.id + '|' + code), until: Date.now() + 15 * 60000, tries: 0, sentAt: Date.now() }));
  MailApp.sendEmail(u.email, 'Tandem password reset code: ' + code, 'Hi ' + u.name + ',\n\nYour Tandem reset code is ' + code + '. It works for 15 minutes.\n\nIf you did not ask for this, ignore this email; your password has not changed.\n\n— Tandem');
  return { ok: true, sentTo: String(u.email).replace(/^(.).*(@.*)$/, '$1•••$2') };
}
function resetConfirm_(req) {
  var u = findUser_(req.userId);
  if (!u) throw fail_('Account not found.');
  var props = PropertiesService.getScriptProperties(), key = 'RST_' + u.id, cur = JSON.parse(props.getProperty(key) || '{}');
  if (!cur.h || cur.until < Date.now()) throw fail_('That code has expired. Ask for a new one.');
  if (cur.tries >= 5) { props.deleteProperty(key); throw fail_('Too many wrong codes. Ask for a new one.'); }
  if (sign_('reset|' + u.id + '|' + String(req.code || '').trim()) !== cur.h) { cur.tries++; props.setProperty(key, JSON.stringify(cur)); throw fail_('That code is not right.'); }
  if (String(req.newPassword || '').length < 6) throw fail_('Password must be at least 6 characters.');
  u.passHash = slowHash_(u.salt, String(req.newPassword));
  upsert_('Users', { id: u.id, passHash: u.passHash });
  props.deleteProperty(key); props.deleteProperty('FAIL_' + u.id);
  return { ok: true, token: token_(u), userId: u.id };
}

/** A full copy of the spreadsheet in the owner's Drive. Runs on the 1st of each month and from "Back up now". */
function backup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var copy = ss.copy(ss.getName() + ' backup ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
  return copy.getUrl();
}

/* Google sign-in: Google verifies the person, we only check the email is linked to one of the two accounts. */
function googleEmail_(credential) {
  var cid = String(setting_('googleClientId', '') || '');
  if (!cid) throw fail_('Google sign-in is not set up yet.');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(credential || '')), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw fail_('Google could not verify that sign-in. Try again, or use your password.');
  var t = JSON.parse(res.getContentText());
  var issOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  if (t.aud !== cid || !issOk || Number(t.exp) * 1000 < Date.now() || String(t.email_verified) !== 'true' || !t.email) throw fail_('That Google sign-in is not valid for this app.');
  return { email: String(t.email).toLowerCase(), name: String(t.given_name || t.name || '') };
}
function googleLogin_(req) {
  var g = googleEmail_(req.credential), users = read_('Users');
  var u = users.filter(function (x) { return x.googleEmail && String(x.googleEmail).toLowerCase() === g.email; })[0];
  if (!u) {
    if (users.length >= 2) throw fail_(g.email + ' is not linked to an account here. Sign in with your password, then link Google in Settings.');
    if (!req.register) throw fail_('No Tandem account is linked to ' + g.email + ' yet.', 'canregister');
    u = { id: 'u' + (users.length + 1), name: (g.name || g.email.split('@')[0]).slice(0, 40), email: g.email, color: USER_COLORS[users.length],
      salt: Utilities.getUuid(), passHash: 'none$' + Utilities.getUuid(), createdAt: String(Date.now()), googleEmail: g.email };
    upsert_('Users', u);
  }
  return { ok: true, token: token_(u), userId: u.id };
}
function linkGoogle_(me, req) {
  if (req.unlink) {
    if (String(me.passHash).indexOf('none$') === 0) throw fail_('Set a password first, or you would be locked out.');
    upsert_('Users', { id: me.id, googleEmail: '' });
    return { ok: true, googleEmail: '' };
  }
  var g = googleEmail_(req.credential);
  if (read_('Users').some(function (x) { return String(x.id) !== String(me.id) && String(x.googleEmail).toLowerCase() === g.email; })) throw fail_('That Google account is already linked to the other person.');
  upsert_('Users', { id: me.id, googleEmail: g.email });
  return { ok: true, googleEmail: g.email };
}

function updateProfile_(me, req) {
  var row = { id: me.id };
  if (req.name != null) { row.name = String(req.name).trim().slice(0, 40) || me.name; }
  if (req.email != null) row.email = String(req.email).trim().slice(0, 120);
  if (req.color != null && /^#[0-9a-fA-F]{6}$/.test(req.color)) row.color = req.color;
  var newHash = me.passHash;
  if (req.newPassword) {
    if (String(me.passHash).indexOf('none$') !== 0 && !checkPw_(me, req.oldPassword)) throw fail_('Current password is wrong.');
    if (String(req.newPassword).length < 6) throw fail_('Password must be at least 6 characters.');
    newHash = row.passHash = slowHash_(me.salt, String(req.newPassword));
  }
  upsert_('Users', row);
  me.passHash = newHash;
  return { ok: true, token: token_(me), data: dump_() };
}

/* ------------------------------------------------------------------ sync */

function sync_(me, req) {
  var errors = [], started = Date.now() - 5000, since = Number(req.since) || 0;      // 5 s overlap so nothing is missed
  (req.ops || []).forEach(function (op) {
    try {
      if (!op || !WRITABLE[op.table]) throw new Error('Table not allowed');
      var row = op.row || {};
      if (!row.id || String(row.id).length > 80) throw new Error('Bad id');
      var isNew = !table_(op.table).rows[String(row.id)];
      row.updatedAt = Date.now();
      if (op.table === 'Expenses') {
        if (!isFinite(Number(row.amount))) throw new Error('Bad amount');     // refunds are negative
        if (isNew) { row.createdBy = me.id; var ca = Number(row.createdAt); row.createdAt = ca > 0 && ca <= Date.now() + 60000 ? ca : Date.now(); }   // keep the time it was logged on the phone
        else { delete row.createdBy; delete row.createdAt; }
      }
      upsert_(op.table, row);
    } catch (err) { errors.push({ id: op && op.row && op.row.id, error: String(err.message || err) }); }
  });
  return { ok: true, data: dump_(since), incremental: since > 0, errors: errors, serverTime: started };
}

/** Everything, or with `since` only rows changed after that moment (users are always sent). */
function dump_(since) {
  var rows = function (name) {
    var all = read_(name);
    return since ? all.filter(function (r) { return Number(r.updatedAt) > since; }) : all;
  };
  return {
    users: read_('Users').map(function (u) { return { id: u.id, name: u.name, email: u.email, color: u.color, googleEmail: u.googleEmail }; }),
    expenses: rows('Expenses'),
    cards: rows('Cards'),
    recurring: rows('Recurring'),
    billPayments: rows('BillPayments'),
    accounts: rows('Accounts'),
    inbox: rows('Inbox'),
    settings: rows('Settings'),
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl()
  };
}

/** When you edit a row by hand in the sheet, stamp it so the app picks the change up on its next sync. */
function onEdit(e) {
  try {
    var sh = e.range.getSheet();
    if (!WRITABLE[sh.getName()]) return;
    var col = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].indexOf('updatedAt') + 1;
    var r0 = Math.max(e.range.getRow(), 2), n = e.range.getLastRow() - r0 + 1;
    if (col < 1 || n < 1 || (e.range.getColumn() === col && e.range.getLastColumn() === col)) return;
    var now = Date.now(), vals = [];
    for (var i = 0; i < n; i++) vals.push([now]);
    sh.getRange(r0, col, n, 1).setValues(vals);
  } catch (err) {}
}

/* ------------------------------------------------------------------ sheet access */

var CACHE_ = {};
function table_(name) {
  if (CACHE_[name]) return CACHE_[name];
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh && name === 'Inbox') { sh = SpreadsheetApp.getActiveSpreadsheet().insertSheet(name); sh.getRange(1, 1, 1, SCHEMA.Inbox.length).setValues([SCHEMA.Inbox]).setFontWeight('bold'); sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), SCHEMA.Inbox.length).setNumberFormat('@'); sh.setFrozenRows(1); }
  if (!sh) throw fail_('Sheet "' + name + '" is missing. Run setup again.', 'setup');
  var heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var missing = (SCHEMA[name] || []).filter(function (h) { return heads.indexOf(h) < 0; });
  if (missing.length && WRITABLE[name]) {          // new version added columns: append them so nothing is dropped before setup is re-run
    if (sh.getMaxColumns() < heads.length + missing.length) sh.insertColumnsAfter(sh.getMaxColumns(), heads.length + missing.length - sh.getMaxColumns());
    sh.getRange(1, heads.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    sh.getRange(2, heads.length + 1, Math.max(sh.getMaxRows() - 1, 1), missing.length).setNumberFormat('@');
    heads = heads.concat(missing);
  }
  var last = sh.getLastRow();
  var idCol = heads.indexOf('id');
  var rows = {};
  if (last > 1) {
    sh.getRange(2, idCol + 1, last - 1, 1).getValues().forEach(function (r, i) {
      if (r[0] !== '') rows[String(r[0])] = i + 2;
    });
  }
  return (CACHE_[name] = { sh: sh, heads: heads, rows: rows, last: Math.max(last, 1) });
}

function read_(name) {
  var t = table_(name);
  if (t.last < 2) return [];
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();   // dates in cells belong to the sheet's time zone
  var idCol = t.heads.indexOf('id');
  return t.sh.getRange(2, 1, t.last - 1, t.heads.length).getValues()
    .filter(function (r) { return r[idCol] !== ''; })
    .map(function (r) {
      var o = {};
      t.heads.forEach(function (h, i) {
        var v = r[i];
        if (Object.prototype.toString.call(v) === '[object Date]') v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        if (h) o[h] = v;
      });
      return o;
    });
}

function clean_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    v = v.slice(0, 2000);
    if (/^[=+]/.test(v)) v = "'" + v;      // never let user text become a formula
  } else if (typeof v === 'object' && !(v instanceof Date)) {
    v = JSON.stringify(v).slice(0, 5000);
  }
  return v;
}

function upsert_(name, row) {
  var t = table_(name);
  var id = String(row.id);
  var r = t.rows[id];
  var cur = {};
  if (r) {
    var vals = t.sh.getRange(r, 1, 1, t.heads.length).getValues()[0];
    t.heads.forEach(function (h, i) { cur[h] = vals[i]; });
  } else {
    r = ++t.last;
    t.rows[id] = r;
    if (r > t.sh.getMaxRows()) t.sh.insertRowsAfter(t.sh.getMaxRows(), 200);
  }
  var out = t.heads.map(function (h) {
    return clean_(Object.prototype.hasOwnProperty.call(row, h) ? row[h] : (cur[h] !== undefined ? cur[h] : ''));
  });
  t.sh.getRange(r, 1, 1, out.length).setValues([out]);
}

/* ------------------------------------------------------------------ credit card reminders */

function pad_(n) { return (n < 10 ? '0' : '') + n; }
function dim_(y, m) { return new Date(y, m, 0).getDate(); }
function dayOn_(y, m, d) { return y + '-' + pad_(m) + '-' + pad_(Math.min(d, dim_(y, m))); }
function shift_(s, day, n) {
  var p = s.split('-').map(Number), y = p[0], m = p[1] + n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return dayOn_(y, m, day);
}
function lastStmt_(today, S) {
  var p = today.split('-').map(Number);
  var s = dayOn_(p[0], p[1], S);
  return s <= today ? s : shift_(s, S, -1);
}
function dueFor_(stmt, D) {
  var p = stmt.split('-').map(Number);
  var d = dayOn_(p[0], p[1], D);
  return d > stmt ? d : shift_(stmt, D, 1);
}
function diffDays_(a, b) {
  var x = a.split('-').map(Number), y = b.split('-').map(Number);
  return Math.round((Date.UTC(x[0], x[1] - 1, x[2]) - Date.UTC(y[0], y[1] - 1, y[2])) / 864e5);
}
function truthy_(v) { return v === true || String(v).toLowerCase() === 'true'; }

function cardStatus_() {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var expenses = read_('Expenses').filter(function (e) { return !truthy_(e.deleted) && e.cardId && (!e.type || String(e.type) === 'expense'); });
  var payments = read_('BillPayments').filter(function (b) { return !truthy_(b.deleted); });
  return read_('Cards').filter(function (c) { return !truthy_(c.deleted); }).map(function (c) {
    var S = Number(c.statementDay) || 1, D = Number(c.dueDay) || 1;
    var ls = lastStmt_(today, S), ps = shift_(ls, S, -1), due = dueFor_(ls, D);
    var billed = 0, unbilled = 0;
    expenses.forEach(function (e) {
      if (String(e.cardId) !== String(c.id)) return;
      var d = String(e.date).slice(0, 10);
      if (d > ps && d <= ls) billed += Number(e.amount) || 0;
      else if (d > ls) unbilled += Number(e.amount) || 0;
    });
    var paid = payments.some(function (b) { return String(b.id) === c.id + '_' + ls; });
    return { card: c, today: today, stmt: ls, due: due, billed: billed, unbilled: unbilled, paid: paid,
      daysToDue: diffDays_(due, today), daysSinceStmt: diffDays_(today, ls) };
  });
}

function setting_(key, fallback) {
  var row = read_('Settings').filter(function (s) { return String(s.id) === key; })[0];
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch (e) { return fallback; }
}

function money_(v) {
  var cur = setting_('currency', '₹');
  return cur + (Math.round(v * 100) / 100).toLocaleString('en-IN');
}

/** Runs every morning (installed by setup). Emails each card owner when a bill is generated and before it is due. */
function dailyReminders() {
  try { monthlySummary_(); } catch (err) { Logger.log(err); }
  try { if (Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd') === '1') backup_(); } catch (err) { Logger.log(err); }
  var remind = Number(setting_('reminderDays', 3)) || 3;
  var users = {};
  read_('Users').forEach(function (u) { users[u.id] = u; });
  cardStatus_().forEach(function (s) {
    var owner = users[s.card.owner];
    if (!owner || !owner.email || s.billed <= 0) return;
    var label = s.card.name + (s.card.last4 ? ' ••' + s.card.last4 : '');
    var subject = null, body = null;
    if (s.daysSinceStmt === 1) {
      subject = '💳 ' + label + ' bill generated: ' + money_(s.billed);
      body = 'Your ' + label + ' statement closed on ' + s.stmt + '.\n\nTracked spend this cycle: ' + money_(s.billed) +
        '\nPay by: ' + s.due + ' (' + s.daysToDue + ' days left)';
    } else if (!s.paid && (s.daysToDue === remind || s.daysToDue === 1 || s.daysToDue === 0)) {
      var when = s.daysToDue === 0 ? 'TODAY' : 'in ' + s.daysToDue + ' day' + (s.daysToDue === 1 ? '' : 's');
      subject = '⏰ ' + label + ' payment due ' + when + ': ' + money_(s.billed);
      body = 'Your ' + label + ' bill of ' + money_(s.billed) + ' (tracked spend) is due on ' + s.due + '.\n\n' +
        'Once paid, tap "Mark paid" on the card in Tandem to stop these reminders.';
    }
    if (subject) MailApp.sendEmail(owner.email, subject, body + '\n\n— Tandem');
  });
}

/** On the 1st: last month's totals, top categories and what is still open. Called from dailyReminders. */
function monthlySummary_() {
  if (setting_('monthlyEmail', true) === false) return;
  var tz = Session.getScriptTimeZone(), now = new Date();
  if (Utilities.formatDate(now, tz, 'd') !== '1') return;
  var prev = new Date(now.getTime() - 5 * 864e5);
  var ym = Utilities.formatDate(prev, tz, 'yyyy-MM'), label = Utilities.formatDate(prev, tz, 'MMMM yyyy');
  var users = read_('Users');
  var names = {}; users.forEach(function (u) { names[u.id] = u.name; });
  var catNames = {}; (setting_('categories', []) || []).forEach(function (c) { catNames[c.id] = (c.emoji ? c.emoji + ' ' : '') + c.name; });
  var total = 0, share = { u1: 0, u2: 0 }, paid = { u1: 0, u2: 0 }, cats = {}, open = 0, openN = 0;
  read_('Expenses').forEach(function (e) {
    if (!truthy_(e.deleted) && String(e.type) === 'settlement' && String(e.category) === 'part' && !e.settledBy) { open += String(e.paidBy) === 'u1' ? Number(e.amount) : -Number(e.amount); openN++; }   // part payment not yet used
    if (truthy_(e.deleted) || (e.type && String(e.type) !== 'expense')) return;   // skip settlements, transfers and money in
    var amt = Number(e.amount) || 0, s1 = Number(e.share1) || 0, s2 = Number(e.share2) || 0;
    if (!e.settledBy) {                     // positive = u2 owes u1
      var lent = String(e.paidBy) === 'u1' ? s2 : -s1;
      if (lent) { open += lent; openN++; }
    }
    if (String(e.date).slice(0, 7) !== ym) return;
    total += amt - (Number(e.friendsShare) || 0); share.u1 += s1; share.u2 += s2;
    paid[e.paidBy] = (paid[e.paidBy] || 0) + amt;
    cats[e.category] = (cats[e.category] || 0) + amt;
  });
  if (!total && !openN) return;
  var top = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).slice(0, 5)
    .map(function (id) { return '  ' + (catNames[id] || (String(id).charAt(0).toUpperCase() + String(id).slice(1)) || 'Other') + ': ' + money_(cats[id]); });
  var n1 = names.u1 || 'Person 1', n2 = names.u2 || 'Person 2';
  var openLine = !openN ? 'All settled up.' : Math.abs(open) < 0.005 ? openN + ' open expenses that cancel out.' :
    openN + ' open expense' + (openN === 1 ? '' : 's') + ': ' + (open > 0 ? n2 + ' owes ' + n1 : n1 + ' owes ' + n2) + ' ' + money_(Math.abs(open)) + '.';
  var body = 'Tandem summary for ' + label + '\n\nTotal spent: ' + money_(total) +
    '\n' + n1 + ': paid ' + money_(paid.u1 || 0) + ', share ' + money_(share.u1) +
    '\n' + n2 + ': paid ' + money_(paid.u2 || 0) + ', share ' + money_(share.u2) +
    (top.length ? '\n\nTop categories:\n' + top.join('\n') : '') + '\n\nTo settle: ' + openLine + '\n\n— Tandem';
  users.forEach(function (u) { if (u.email) MailApp.sendEmail(u.email, '📊 Tandem: ' + label + ' summary', body); });
}

/* ------------------------------------------------------------------ timed prompts ("Ask me" recurring) */

function quickKey_(me, req) {
  var key = me.quickKey;
  if (!key || req.reset) { key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); upsert_('Users', { id: me.id, quickKey: key }); }
  return { ok: true, key: key };
}

function shares_(amount, paidBy, splitType, payerPct) {
  var pct1 = splitType === 'personal' ? (paidBy === 'u1' ? 100 : 0) : splitType === 'other' ? (paidBy === 'u1' ? 0 : 100) :
    splitType === 'custom' ? (paidBy === 'u1' ? Number(payerPct) : 100 - Number(payerPct)) : Number(setting_('defaultSplit', 50));
  if (!isFinite(pct1)) pct1 = 50;
  var s1 = Math.round(amount * pct1) / 100;
  return { share1: s1, share2: Math.round((amount - s1) * 100) / 100 };
}

/** A link tapped from a notification or a Shortcut: add or skip today's entry for one "Ask me" item. */
function quick_(q) {
  var u = read_('Users').filter(function (x) { return x.quickKey && String(x.quickKey) === String(q.quick); })[0];
  if (!u) return 'Tandem: this link is no longer valid. Copy a new one from the app.';
  var r = read_('Recurring').filter(function (x) { return String(x.id) === String(q.rid); })[0];
  if (!r || truthy_(r.deleted) || String(r.schedule) !== 'ask' || String(r.paidBy) !== String(u.id)) return 'Tandem: that item no longer exists.';
  var date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), id = 'ask_' + r.id + '_' + date;
  if (table_('Expenses').rows[id]) return 'Already added today: ' + r.description;
  var skipKey = 'askSkips_' + u.id, skips = setting_(skipKey, []) || [];
  if (q['do'] === 'skip') {
    if (skips.indexOf(id) < 0) skips.push(id);
    upsert_('Settings', { id: skipKey, value: JSON.stringify(skips.slice(-40)), updatedAt: Date.now() });
    return 'Skipped ' + r.description + ' for today.';
  }
  if (q['do'] !== 'add') return 'Tandem: unknown action.';
  var amount = Number(r.amount) || 0, mode = String(r.mode);
  var acct = read_('Accounts').filter(function (a) { return String(a.id) === String(r.accountId); })[0];
  var sh = shares_(amount, String(r.paidBy), String(r.splitType), r.payerPct);
  upsert_('Expenses', { id: id, type: 'expense', date: date, amount: amount, description: r.description, category: r.category, paidBy: r.paidBy,
    mode: mode, cardId: r.cardId, accountId: r.accountId, upiApp: mode === 'upi' && acct ? String(acct.upiApp || '').split(',')[0].trim() : '', debitCardId: mode === 'debit_card' && acct ? (function () { try { return (JSON.parse(acct.debitCards || '[]')[0] || {}).id || ''; } catch (e) { return ''; } })() : '', splitType: r.splitType,
    share1: sh.share1, share2: sh.share2, notes: '', recurringId: r.id, createdBy: u.id, createdAt: Date.now(), updatedAt: Date.now(), deleted: false });
  if (skips.indexOf(id) >= 0) upsert_('Settings', { id: skipKey, value: JSON.stringify(skips.filter(function (x) { return x !== id; })), updatedAt: Date.now() });
  return 'Added ' + r.description + ' ' + money_(amount);
}

function ntfy_(payload) {
  return UrlFetchApp.fetch('https://ntfy.sh/', { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }).getResponseCode();
}

function ntfyTest_(me, req) {
  var topic = String(req.topic || setting_('ntfy_' + me.id, ''));
  if (!/^[A-Za-z0-9_-]{8,60}$/.test(topic)) throw fail_('Save a topic first.');
  var code = ntfy_({ topic: topic, title: 'Tandem is connected', message: 'You will get Add / Not today prompts here for your "Ask me" items.', tags: ['white_check_mark'] });
  if (code >= 300) throw fail_('ntfy did not accept the message (code ' + code + ').');
  return { ok: true };
}

/** Runs every 5 minutes (installed by setup). Sends each due "Ask me" item once a day to its payer's ntfy topic. */
function askNotify() {
  var recs = read_('Recurring').filter(function (r) { return String(r.schedule) === 'ask' && truthy_(r.active) && !truthy_(r.deleted) && Number(r.amount) > 0; });
  if (!recs.length) return;
  var api = setting_('quickApi', ''), appUrl = setting_('appUrl', '');
  if (!api) return;
  var tz = Session.getScriptTimeZone(), now = new Date();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd'), hm = Utilities.formatDate(now, tz, 'HH:mm');
  var dow = String(Number(Utilities.formatDate(now, tz, 'u')) % 7);            // 0 = Sunday, like the app
  var props = PropertiesService.getScriptProperties();
  var sent = JSON.parse(props.getProperty('ASK_SENT') || '{}');
  if (sent.day !== today) sent = { day: today, ids: [] };
  var users = {}; read_('Users').forEach(function (u) { users[u.id] = u; });
  var rows = null, changed = false;
  recs.forEach(function (r) {
    var id = 'ask_' + r.id + '_' + today, u = users[r.paidBy];
    if (!u || !u.quickKey || sent.ids.indexOf(id) >= 0) return;
    if (String(r.days).split(',').indexOf(dow) < 0 || hm < String(r.askTime).slice(0, 5)) return;
    if (r.startDate && today < String(r.startDate).slice(0, 10)) return;
    var topic = setting_('ntfy_' + u.id, '');
    if (!topic) return;
    rows = rows || table_('Expenses').rows;
    sent.ids.push(id); changed = true;
    if (rows[id] || (setting_('askSkips_' + u.id, []) || []).indexOf(id) >= 0) return;     // already answered in the app
    var link = api + '?quick=' + encodeURIComponent(u.quickKey) + '&rid=' + encodeURIComponent(r.id) + '&do=';
    var payload = { topic: topic, title: r.description + ' today?', message: money_(Number(r.amount)) + ' · Add it or skip', tags: ['fork_and_knife'],
      actions: [{ action: 'http', label: 'Add ' + money_(Number(r.amount)), url: link + 'add', method: 'GET', clear: true },
                { action: 'http', label: 'Not today', url: link + 'skip', method: 'GET', clear: true }] };
    if (appUrl) payload.click = appUrl;
    ntfy_(payload);
  });
  if (changed) props.setProperty('ASK_SENT', JSON.stringify(sent));
}

function testEmail_(me) {
  if (!me.email) throw fail_('Add your email in Settings first.');
  var lines = cardStatus_().filter(function (s) { return String(s.card.owner) === String(me.id); }).map(function (s) {
    return '• ' + s.card.name + ': billed ' + money_(s.billed) + ' (due ' + s.due + (s.paid ? ', paid' : '') + '), unbilled ' + money_(s.unbilled);
  });
  MailApp.sendEmail(me.email, '✅ Tandem reminders are working',
    'Hi ' + me.name + ',\n\nThis is a test. You will get an email when a card bill is generated and again before it is due.\n\n' +
    (lines.length ? 'Your cards right now:\n' + lines.join('\n') : 'You have no cards yet.') + '\n\n— Tandem');
  return { ok: true };
}

/* ------------------------------------------------------------------ bank SMS forwarding */

/** Saves a forwarded bank SMS for review in the app. Only payment messages are kept; OTPs and offers are dropped. */
function sms_(q) {
  var u = read_('Users').filter(function (x) { return x.quickKey && String(x.quickKey) === String(q.key); })[0];
  if (!u) return 'Tandem: this forwarding link is no longer valid. Copy a new one from the app.';
  var text = String(q.text || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  if (!text) return 'Tandem: no message text received.';
  if (/\botp\b|one.?time.?pass|verification code|do not share/i.test(text)) return 'Tandem: ignored (OTP).';
  if (!/(?:rs\.?|inr|₹)\s*[0-9]/i.test(text)) return 'Tandem: ignored (no amount).';
  if (!/debit|spent|paid|sent|withdrawn|purchase|txn|transaction|credit|received|deposit|refund|transfer/i.test(text) ||
      /pre-?approved|eligible|apply now|offer|win |congrat|(?:min(?:imum)?|total)\s+(?:amount\s+)?due|statement (?:is )?generated|will be debited|is due/i.test(text)) return 'Tandem: ignored (not a payment).';
  var id = 'sms_' + u.id + '_' + hashText_(text);
  if (table_('Inbox').rows[id]) return 'Tandem: already received.';
  upsert_('Inbox', { id: id, owner: u.id, at: Date.now(), sender: String(q.from || '').slice(0, 40), text: text, status: 'new', expenseId: '', updatedAt: Date.now() });
  return 'Tandem: saved for review.';
}

function hashText_(t) { var h = 5381, h2 = 52711; for (var i = 0; i < t.length; i++) { var c = t.charCodeAt(i); h = (h * 33) ^ c; h2 = (h2 * 33) ^ c; } return (h >>> 0).toString(36) + (h2 >>> 0).toString(36); }

/* ------------------------------------------------------------------ receipt photos (kept in a Drive folder) */

function receiptFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('RECEIPTS');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder(APP + ' receipts');
  p.setProperty('RECEIPTS', f.getId());
  return f;
}
function receiptFile_(id) {
  var f = DriveApp.getFileById(String(id || '')), folder = receiptFolder_().getId(), it = f.getParents(), ok = false;
  while (it.hasNext()) if (it.next().getId() === folder) ok = true;
  if (!ok) throw fail_('Not a Tandem receipt');
  return f;
}
function receiptUp_(me, req) {
  var data = String(req.data || '');
  if (!data || data.length > 2500000) throw fail_('Photo is too large');
  var name = 'receipt_' + String(req.expenseId || '').replace(/[^\w-]/g, '').slice(0, 40) + '_' + Date.now() + '.jpg';
  var file = receiptFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', name));
  return { ok: true, id: file.getId() };
}
function receiptGet_(me, req) {
  var f = receiptFile_(req.id);
  return { ok: true, data: Utilities.base64Encode(f.getBlob().getBytes()) };
}
function receiptDel_(me, req) {
  try { receiptFile_(req.id).setTrashed(true); } catch (e) {}
  return { ok: true };
}

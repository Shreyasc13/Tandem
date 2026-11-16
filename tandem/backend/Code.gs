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
  Users: ['id', 'name', 'email', 'color', 'salt', 'passHash', 'createdAt'],
  Expenses: ['id', 'type', 'date', 'amount', 'description', 'category', 'paidBy', 'mode', 'cardId',
    'splitType', 'share1', 'share2', 'notes', 'recurringId', 'settledBy', 'createdBy', 'createdAt', 'updatedAt', 'deleted'],
  Cards: ['id', 'owner', 'name', 'last4', 'statementDay', 'dueDay', 'limit', 'deleted', 'updatedAt'],
  Recurring: ['id', 'description', 'amount', 'category', 'paidBy', 'mode', 'cardId', 'splitType',
    'payerPct', 'dayOfMonth', 'active', 'deleted', 'updatedAt'],
  BillPayments: ['id', 'cardId', 'cycle', 'paidOn', 'paidBy', 'deleted', 'updatedAt'],
  Settings: ['id', 'value', 'updatedAt']
};
var WRITABLE = { Expenses: 1, Cards: 1, Recurring: 1, BillPayments: 1, Settings: 1 };
var NUMERIC = { amount: '0.00', share1: '0.00', share2: '0.00', createdAt: '0', updatedAt: '0' };
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
    if (t.getHandlerFunction() === 'dailyReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyReminders').timeBased().everyDays(1).atHour(9).create();
  Logger.log('Tandem is set up. Now: Deploy -> New deployment -> Web app.');
}

/* ------------------------------------------------------------------ http */

function doGet() {
  return json_({ ok: true, app: APP, message: 'Tandem backend is running. Paste this URL into the app.' });
}

function doPost(e) {
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
  }
  var me = auth_(req.token);
  switch (req.action) {
    case 'sync': return sync_(me, req);
    case 'updateProfile': return updateProfile_(me, req);
    case 'testEmail': return testEmail_(me);
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
  return { ok: true, app: APP, users: users, canRegister: users.length < 2 };
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
    color: USER_COLORS[users.length], salt: salt, passHash: hash_(salt, pw), createdAt: String(Date.now())
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
  if (hash_(u.salt, String(req.password || '')) !== u.passHash) {
    f.n++;
    if (f.n >= 5) { f.until = Date.now() + 15 * 60000; f.n = 0; }
    props.setProperty(key, JSON.stringify(f));
    throw fail_('Wrong password.');
  }
  props.deleteProperty(key);
  return { ok: true, token: token_(u), userId: u.id };
}

function updateProfile_(me, req) {
  var row = { id: me.id };
  if (req.name != null) { row.name = String(req.name).trim().slice(0, 40) || me.name; }
  if (req.email != null) row.email = String(req.email).trim().slice(0, 120);
  if (req.color != null && /^#[0-9a-fA-F]{6}$/.test(req.color)) row.color = req.color;
  var newHash = me.passHash;
  if (req.newPassword) {
    if (hash_(me.salt, String(req.oldPassword || '')) !== me.passHash) throw fail_('Current password is wrong.');
    if (String(req.newPassword).length < 6) throw fail_('Password must be at least 6 characters.');
    newHash = row.passHash = hash_(me.salt, String(req.newPassword));
  }
  upsert_('Users', row);
  me.passHash = newHash;
  return { ok: true, token: token_(me), data: dump_() };
}

/* ------------------------------------------------------------------ sync */

function sync_(me, req) {
  var errors = [];
  (req.ops || []).forEach(function (op) {
    try {
      if (!op || !WRITABLE[op.table]) throw new Error('Table not allowed');
      var row = op.row || {};
      if (!row.id || String(row.id).length > 80) throw new Error('Bad id');
      var isNew = !table_(op.table).rows[String(row.id)];
      row.updatedAt = Date.now();
      if (op.table === 'Expenses') {
        if (!(Number(row.amount) >= 0)) throw new Error('Bad amount');
        if (isNew) { row.createdBy = me.id; row.createdAt = Date.now(); }
        else { delete row.createdBy; delete row.createdAt; }
      }
      upsert_(op.table, row);
    } catch (err) { errors.push({ id: op && op.row && op.row.id, error: String(err.message || err) }); }
  });
  return { ok: true, data: dump_(), errors: errors, serverTime: Date.now() };
}

function dump_() {
  return {
    users: read_('Users').map(function (u) { return { id: u.id, name: u.name, email: u.email, color: u.color }; }),
    expenses: read_('Expenses'),
    cards: read_('Cards'),
    recurring: read_('Recurring'),
    billPayments: read_('BillPayments'),
    settings: read_('Settings'),
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl()
  };
}

/* ------------------------------------------------------------------ sheet access */

var CACHE_ = {};
function table_(name) {
  if (CACHE_[name]) return CACHE_[name];
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw fail_('Sheet "' + name + '" is missing. Run setup again.', 'setup');
  var heads = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
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
  var expenses = read_('Expenses').filter(function (e) { return !truthy_(e.deleted) && e.cardId && String(e.type) !== 'settlement'; });
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
    if (truthy_(e.deleted) || String(e.type) === 'settlement') return;
    var amt = Number(e.amount) || 0, s1 = Number(e.share1) || 0, s2 = Number(e.share2) || 0;
    if (!e.settledBy) {                     // positive = u2 owes u1
      var lent = String(e.paidBy) === 'u1' ? s2 : -s1;
      if (lent) { open += lent; openN++; }
    }
    if (String(e.date).slice(0, 7) !== ym) return;
    total += amt; share.u1 += s1; share.u2 += s2;
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

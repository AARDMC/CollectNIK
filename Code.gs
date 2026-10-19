/* Form Builder Pro — Google Apps Script backend (v2.0 clean) */

const SECRET        = 'CHANGE_ME_TO_LONG_RANDOM_STRING';
const ROOT          = 'FormBuilder Data';
const PUBLIC_SUBMIT = true;
const MAX_ROWS      = 5000;
const VERSION       = '2.0';

/* ---------- helpers ---------- */
const out_  = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const safe_ = s => String(s).replace(/[^\w-]/g, '_').slice(0, 80);
const title_= s => String(s || 'Untitled').replace(/[\/\\?%*:|"<>]/g, '_').slice(0, 60);

function root_() {
  const i = DriveApp.getFoldersByName(ROOT);
  return i.hasNext() ? i.next() : DriveApp.createFolder(ROOT);
}
function sub_(p, n) {
  const i = p.getFoldersByName(n);
  return i.hasNext() ? i.next() : p.createFolder(n);
}
function flat_(o, p, r) {
  r = r || {};
  Object.keys(o).forEach(k => {
    const v = o[k], key = p ? p + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat_(v, key, r);
    else r[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  });
  return r;
}
function formFile_(id) {
  const it = sub_(root_(), 'forms').getFilesByName('form_' + safe_(id) + '.json');
  return it.hasNext() ? it.next() : null;
}
function ss_(id) {
  const ff = formFile_(id); if (!ff) return null;
  const title = title_(JSON.parse(ff.getBlob().getDataAsString()).title);
  const it = sub_(root_(), 'data').getFilesByName(title + ' - ' + safe_(id));
  return it.hasNext() ? SpreadsheetApp.open(it.next()) : null;
}
function log_(action, who, detail) {
  try {
    const f = sub_(root_(), 'logs');
    const name = 'audit_' + new Date().toISOString().slice(0, 10) + '.csv';
    const it = f.getFilesByName(name);
    const line = [new Date().toISOString(), action, who || '', detail || '']
      .map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',') + '\n';
    const file = it.hasNext() ? it.next() : f.createFile(name, '', 'text/csv');
    file.setContent(file.getBlob().getDataAsString() + line);
  } catch (e) { /* never let logging break the request */ }
}

/* ---------- auth ---------- */
const RANK = { collector: 1, reviewer: 2, admin: 3 };
const users_ = () => {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('users') || '{}'); }
  catch (e) { return {}; }
};
const hash_ = (salt, pw) => Utilities.base64Encode(
  Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pw));
const sign_ = s => Utilities.base64EncodeWebSafe(
  Utilities.computeHmacSha256Signature(s, SECRET));
function mkToken_(u, role) {
  const p = u + '|' + role + '|' + (Date.now() + 12 * 3600e3);
  return Utilities.base64EncodeWebSafe(p) + '.' + sign_(p);
}
function who_(b) {
  if (b.secret && b.secret === SECRET) return { user: 'admin', role: 'admin' };
  if (!b.token) return null;
  try {
    const parts = b.token.split('.');
    const pl = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    if (sign_(pl) !== parts[1]) return null;
    const a = pl.split('|'); if (+a[2] < Date.now()) return null;
    return { user: a[0], role: a[1] };
  } catch (e) { return null; }
}
const need_ = (b, role) => { const w = who_(b); return w && RANK[w.role] >= RANK[role] ? w : null; };

/* ---------- one-time setup ---------- */
/* Edit BOOT_USER / BOOT_PASS below, then run bootstrap() once from the editor.
   It creates the Drive folders and the first admin user. Afterwards, change
   BOOT_PASS back to a placeholder so the password isn't left in the script. */
const BOOT_USER = 'admin';
const BOOT_PASS = 'CHANGE_ME_8+_CHARS';

function bootstrap() {
  if (SECRET === 'CHANGE_ME_TO_LONG_RANDOM_STRING') throw new Error('Set SECRET first.');
  if (BOOT_PASS === 'CHANGE_ME_8+_CHARS' || BOOT_PASS.length < 8) throw new Error('Set BOOT_PASS (8+ chars) first.');
  const r = root_();
  ['forms', 'data', 'media', 'logs', 'versions'].forEach(n => sub_(r, n));
  const us = users_(), salt = Utilities.getUuid();
  us[BOOT_USER] = { salt: salt, hash: hash_(salt, BOOT_PASS), role: 'admin' };
  PropertiesService.getScriptProperties().setProperty('users', JSON.stringify(us));
  log_('bootstrap', BOOT_USER, '');
  Logger.log('Ready. Drive folder: ' + r.getUrl() + ' | admin user: ' + BOOT_USER);
}

/* ---------- GET ---------- */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.action === 'form') {
    const f = formFile_(p.id || '');
    return out_(f ? { ok: true, config: JSON.parse(f.getBlob().getDataAsString()) }
                  : { ok: false, error: 'Form not found' });
  }
  if (p.action === 'health')
    return out_({ ok: true, service: 'Form Builder Pro', version: VERSION, time: new Date().toISOString() });
  return out_({ ok: true, service: 'Form Builder Pro', version: VERSION });
}

/* ---------- POST ---------- */
function doPost(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const b = JSON.parse(e.postData.contents);

    if (b.action === 'publish') {
      const w = need_(b, 'admin');
      if (!w) return out_({ ok: false, error: 'Admin login or secret required' });
      const dir = sub_(root_(), 'forms'), name = 'form_' + safe_(b.formId) + '.json';
      const f = formFile_(b.formId), txt = JSON.stringify(b.config);
      if (f) {
        const vdir = sub_(sub_(root_(), 'versions'), safe_(b.formId));
        vdir.createFile('v_' + Date.now() + '.json', f.getBlob().getDataAsString(), 'application/json');
        f.setContent(txt);
      } else dir.createFile(name, txt, 'application/json');
      log_('publish', w.user, b.formId);
      return out_({ ok: true, folderUrl: root_().getUrl() });
    }

    if (b.action === 'submit') {
      if (!PUBLIC_SUBMIT && !need_(b, 'collector'))
        return out_({ ok: false, error: 'Login required' });
      const ff = formFile_(b.formId);
      if (!ff) return out_({ ok: false, error: 'Form not published' });
      const title = title_(JSON.parse(ff.getBlob().getDataAsString()).title);
      const data = sub_(root_(), 'data'), sname = title + ' - ' + safe_(b.formId);
      const it = data.getFilesByName(sname);
      const ss = it.hasNext() ? SpreadsheetApp.open(it.next())
        : (function () {
            const s = SpreadsheetApp.create(sname);
            DriveApp.getFileById(s.getId()).moveTo(data);
            return s;
          })();
      const sh = ss.getSheets()[0], rec = b.rec || {};
      if (rec._id && sh.getLastRow() > 1 &&
          sh.createTextFinder(rec._id).matchEntireCell(true).findNext())
        return out_({ ok: true, duplicate: true });
      const media = sub_(sub_(root_(), 'media'), safe_(b.formId));
      (b.files || []).forEach(f => {
        try {
          const blob = Utilities.newBlob(
            Utilities.base64Decode(f.data),
            f.mime || 'application/octet-stream',
            (rec._id || Date.now()) + '_' + f.name);
          rec[f.field] = media.createFile(blob).getUrl();
        } catch (err) { /* skip broken file */ }
      });
      rec._status = rec._status || 'New';
      rec._serverReceived = new Date().toISOString();
      const row = flat_(rec);
      let head = sh.getLastRow()
        ? sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].filter(String)
        : [];
      Object.keys(row).forEach(k => { if (head.indexOf(k) < 0) head.push(k); });
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      const safeVal = v => (typeof v === 'string' && /^[=+\-@]/.test(v)) ? "'" + v : v;
      sh.appendRow(head.map(k => row[k] === undefined ? '' : safeVal(row[k])));
      return out_({ ok: true, sheetUrl: ss.getUrl() });
    }

    if (b.action === 'login') {
      const u = users_()[b.user];
      if (!u || hash_(u.salt, b.pass || '') !== u.hash)
        return out_({ ok: false, error: 'Wrong username or password' });
      log_('login', b.user, '');
      return out_({ ok: true, token: mkToken_(b.user, u.role), role: u.role });
    }

    if (b.action === 'adduser') {
      const w = need_(b, 'admin');
      if (!w) return out_({ ok: false, error: 'Admin required' });
      if (!/^[\w.-]{3,30}$/.test(b.name || '') || (b.pass || '').length < 8)
        return out_({ ok: false, error: 'Username 3-30 chars; password 8+' });
      if (!RANK[b.role]) return out_({ ok: false, error: 'Bad role' });
      const us = users_(), salt = Utilities.getUuid();
      us[b.name] = { salt, hash: hash_(salt, b.pass), role: b.role };
      PropertiesService.getScriptProperties().setProperty('users', JSON.stringify(us));
      log_('adduser', w.user, b.name + ':' + b.role);
      return out_({ ok: true });
    }

    if (b.action === 'listusers') {
      if (!need_(b, 'admin')) return out_({ ok: false, error: 'Admin required' });
      const us = users_();
      return out_({ ok: true, users: Object.keys(us).map(n => ({ name: n, role: us[n].role })) });
    }

    if (b.action === 'deluser') {
      const w = need_(b, 'admin');
      if (!w) return out_({ ok: false, error: 'Admin required' });
      const us = users_(); delete us[b.name];
      PropertiesService.getScriptProperties().setProperty('users', JSON.stringify(us));
      log_('deluser', w.user, b.name);
      return out_({ ok: true });
    }

    if (b.action === 'list') {
      if (!need_(b, 'reviewer')) return out_({ ok: false, error: 'Reviewer login required' });
      const ss = ss_(b.formId); if (!ss) return out_({ ok: true, rows: [], total: 0 });
      const v = ss.getSheets()[0].getDataRange().getValues(), h = v[0];
      let rows = v.slice(1).map(r => {
        const o = {}; h.forEach((k, i) => o[k] = r[i] instanceof Date ? r[i].toISOString() : r[i]); return o;
      });
      if (b.status) rows = rows.filter(r => r._status === b.status);
      if (b.q) { const q = String(b.q).toLowerCase(); rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q)); }
      const total = rows.length;
      const offset = +b.offset || 0, limit = Math.min(+b.limit || MAX_ROWS, MAX_ROWS);
      return out_({ ok: true, sheetUrl: ss.getUrl(), total, rows: rows.slice(offset, offset + limit) });
    }

    if (b.action === 'setstatus') {
      const w = need_(b, 'reviewer');
      if (!w) return out_({ ok: false, error: 'Reviewer login required' });
      const ss = ss_(b.formId); if (!ss) return out_({ ok: false, error: 'No data yet' });
      const sh = ss.getSheets()[0];
      const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      ['_status','_comment','_reviewedBy','_reviewedAt'].forEach(k => {
        if (h.indexOf(k) < 0) { h.push(k); sh.getRange(1, h.length).setValue(k).setFontWeight('bold'); }
      });
      const f = sh.createTextFinder(b.rowId).matchEntireCell(true).findNext();
      if (!f) return out_({ ok: false, error: 'Row not found' });
      const set = (k, v) => sh.getRange(f.getRow(), h.indexOf(k) + 1).setValue(v);
      set('_status', b.status);
      set('_comment', b.comment || '');
      set('_reviewedBy', w.user);
      set('_reviewedAt', new Date().toISOString());
      log_('review', w.user, b.formId + ':' + b.rowId + ':' + b.status);
      return out_({ ok: true, reviewedBy: w.user });
    }

    if (b.action === 'delete') {
      const w = need_(b, 'admin');
      if (!w) return out_({ ok: false, error: 'Admin required' });
      const ss = ss_(b.formId); if (!ss) return out_({ ok: false, error: 'No data' });
      const sh = ss.getSheets()[0];
      const f = sh.createTextFinder(b.rowId).matchEntireCell(true).findNext();
      if (!f) return out_({ ok: false, error: 'Row not found' });
      sh.deleteRow(f.getRow());
      log_('delete', w.user, b.formId + ':' + b.rowId);
      return out_({ ok: true });
    }

    return out_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}
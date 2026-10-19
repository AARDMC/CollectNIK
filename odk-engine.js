/* odk-engine.js — ODK/XLSForm expression engine. Load BEFORE main app. */
(function () {
'use strict';

/* ---------- helpers ---------- */
const DAY = 864e5, DATE = /^\d{4}-\d{2}-\d{2}$/;
const asArr = v => Array.isArray(v) ? v.flat(Infinity) : (v === '' || v == null ? [] : [v]);
const sel = v => (Array.isArray(v) ? asArr(v) : String(v == null ? '' : v).split(' ')).map(String).filter(Boolean);
function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return +v;
  if (Array.isArray(v)) v = v[0];
  if (v == null || v === '') return NaN;
  if (typeof v === 'string' && DATE.test(v)) return Math.floor(Date.parse(v) / DAY);
  return Number(v);
}
const nums = a => a.flatMap(asArr).map(num).filter(x => !isNaN(x));
const str = v => Array.isArray(v) ? asArr(v).join(' ') : v == null ? '' : typeof v === 'number' ? String(Math.round(v * 1e8) / 1e8) : String(v);
const bool = v => Array.isArray(v) ? v.length > 0
  : typeof v === 'string' ? !['', '0', 'false', 'no'].includes(v.trim().toLowerCase())
  : !!v;
const isoDay = d => d.toISOString().slice(0, 10);
const localToday = () => isoDay(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4));
function cmp(a, b, op) {
  const x = num(a), y = num(b), numeric = !isNaN(x) && !isNaN(y), p = numeric ? x : str(a), q = numeric ? y : str(b);
  return op === '=' ? p === q : op === '!=' ? p !== q : op === '<' ? p < q : op === '<=' ? p <= q : op === '>' ? p > q : p >= q;
}
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], pad = n => String(n).padStart(2, '0');
function formatDate(d, f) {
  const n = typeof d === 'string' && !DATE.test(d) ? Date.parse(d) : num(d) * DAY, t = new Date(n);
  if (isNaN(t)) return '';
  const m = { '%Y': t.getUTCFullYear(), '%y': pad(t.getUTCFullYear() % 100), '%m': pad(t.getUTCMonth() + 1),
    '%d': pad(t.getUTCDate()), '%e': t.getUTCDate(), '%b': MON[t.getUTCMonth()],
    '%H': pad(t.getUTCHours()), '%M': pad(t.getUTCMinutes()), '%S': pad(t.getUTCSeconds()) };
  return str(f).replace(/%[YymdebHMS]/g, k => m[k]);
}

/* ---------- function library ---------- */
const F = {
  'if': (c, a, b) => bool(c) ? a : b,
  coalesce: (a, b) => (a === '' || a == null || (typeof a === 'number' && isNaN(a))) ? b : a,
  not: a => !bool(a), 'true': () => true, 'false': () => false, boolean: bool,
  selected: (a, b) => sel(a).includes(str(b)),
  'count-selected': a => sel(a).length,
  'selected-at': (a, i) => sel(a)[num(i)] || '',
  count: a => asArr(a).filter(x => x !== '').length,
  'count-non-empty': a => asArr(a).filter(x => x !== '').length,
  sum: (...a) => nums(a).reduce((s, x) => s + x, 0),
  min: (...a) => { const n = nums(a); return n.length ? Math.min(...n) : NaN; },
  max: (...a) => { const n = nums(a); return n.length ? Math.max(...n) : NaN; },
  round: (a, d = 0) => { const m = Math.pow(10, num(d)); return Math.round(num(a) * m) / m; },
  int: a => Math.trunc(num(a)), number: num, string: str, abs: a => Math.abs(num(a)),
  pow: (a, b) => Math.pow(num(a), num(b)), sqrt: a => Math.sqrt(num(a)),
  log: a => Math.log(num(a)), log10: a => Math.log10(num(a)),
  pi: () => Math.PI, random: () => Math.random(),
  'string-length': a => str(a).length,
  concat: (...a) => a.map(str).join(''),
  join: (s, ...a) => a.flatMap(asArr).map(str).join(str(s)),
  substr: (s, i, j) => str(s).substring(num(i), j === undefined ? undefined : num(j)),
  contains: (a, b) => str(a).includes(str(b)),
  'starts-with': (a, b) => str(a).startsWith(str(b)),
  'ends-with': (a, b) => str(a).endsWith(str(b)),
  'normalize-space': s => str(s).trim().replace(/\s+/g, ' '),
  regex: (a, r) => { try { return new RegExp('^(?:' + str(r) + ')$').test(str(a)); } catch (e) { return false; } },
  today: localToday, now: () => new Date().toISOString(),
  date: a => { const n = num(a); return isNaN(n) ? '' : isoDay(new Date(n * DAY)); },
  'format-date': formatDate
};

/* ---------- tokenizer ---------- */
const TOKEN = /\s*(?:(\d+\.?\d*|\.\d+)|'([^']*)'|"([^"]*)"|\$\{([^}]+)\}|([A-Za-z_][\w]*)|(!=|<=|>=|[-+*=<>(),.]))/y;
const WORD_OPS = ['and', 'or', 'div', 'mod'];

function tokenize(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) { if (!src.slice(i).trim()) break; throw new Error('Unexpected "' + src.slice(i).trim()[0] + '"'); }
    i = TOKEN.lastIndex;
    if (m[1] !== undefined) out.push({ k: 'n', v: parseFloat(m[1]) });
    else if (m[2] !== undefined || m[3] !== undefined) out.push({ k: 's', v: m[2] !== undefined ? m[2] : m[3] });
    else if (m[4] !== undefined) out.push({ k: 'v', v: m[4].trim() });
    else if (m[5] !== undefined) {
      const id = m[5];
      const call = !WORD_OPS.includes(id) && /^\s*\(/.test(src.slice(i));
      out.push({ k: call ? 'f' : WORD_OPS.includes(id) ? 'o' : 'v', v: id });
    } else out.push({ k: 'o', v: m[6] });
  }
  return out;
}

/* ---------- parser ---------- */
function parse(tk) {
  let p = 0;
  const isOp = v => tk[p] && tk[p].k === 'o' && tk[p].v === v;
  const level = (next, ops) => () => {
    let l = next();
    while (tk[p] && tk[p].k === 'o' && ops.includes(tk[p].v)) {
      const op = tk[p++].v; l = { t: 'b', op, l, r: next() };
    }
    return l;
  };
  const primary = () => {
    const k = tk[p++];
    if (!k) throw new Error('Unexpected end of expression');
    if (k.k === 'n' || k.k === 's') return { t: 'c', v: k.v };
    if (k.k === 'v') return k.v === 'true' ? { t: 'c', v: true } : k.v === 'false' ? { t: 'c', v: false } : { t: 'v', n: k.v };
    if (k.k === 'f') {
      if (!F[k.v]) throw new Error('Unknown function ' + k.v + '()');
      p++; const a = [];
      if (!isOp(')')) do a.push(or()); while (isOp(',') && ++p);
      if (!isOp(')')) throw new Error('Missing ) after ' + k.v + '(');
      p++; return { t: 'f', n: k.v, a };
    }
    if (k.v === '.') return { t: 'd' };
    if (k.v === '(') { const e = or(); if (!isOp(')')) throw new Error('Missing )'); p++; return e; }
    throw new Error('Unexpected "' + k.v + '"');
  };
  const unary = () => isOp('-') ? (p++, { t: 'u', e: unary() }) : primary();
  const mul = level(unary, ['*', 'div', 'mod']), add = level(mul, ['+', '-']),
        rel = level(add, ['<', '<=', '>', '>=']), eq = level(rel, ['=', '!=']),
        and = level(eq, ['and']), or = level(and, ['or']);
  const ast = or();
  if (p < tk.length) throw new Error('Unexpected "' + tk[p].v + '"');
  return ast;
}

function ev(n, cx) {
  switch (n.t) {
    case 'c': return n.v;
    case 'd': return cx.dot;
    case 'v': return cx.get(n.n);
    case 'u': return -num(ev(n.e, cx));
    case 'f': return F[n.n](...n.a.map(a => ev(a, cx)));
    case 'b': {
      if (n.op === 'and') return bool(ev(n.l, cx)) && bool(ev(n.r, cx));
      if (n.op === 'or') return bool(ev(n.l, cx)) || bool(ev(n.r, cx));
      const a = ev(n.l, cx), b = ev(n.r, cx);
      switch (n.op) {
        case '+': return num(a) + num(b);
        case '-': return num(a) - num(b);
        case '*': return num(a) * num(b);
        case 'div': return num(a) / num(b);
        case 'mod': return num(a) % num(b);
        default: return cmp(a, b, n.op);
      }
    }
  }
}

/* ---------- public API ---------- */
const cache = new Map();
function compile(src) {
  src = String(src || '').trim();
  if (!src) return null;
  if (!cache.has(src)) {
    try { cache.set(src, { ast: parse(tokenize(src)) }); }
    catch (e) { cache.set(src, { error: e.message }); }
  }
  return cache.get(src);
}
function run(src, cx) { const c = compile(src); if (!c || c.error) return undefined; try { return ev(c.ast, cx); } catch (e) { return undefined; } }
function truth(src, cx, dflt) { const r = run(src, cx); return r === undefined ? dflt : bool(r); }
function error(src) { const c = compile(src); return (c && c.error) || ''; }
function show(v) {
  return typeof v === 'number' ? (isFinite(v) ? String(Math.round(v * 1e4) / 1e4) : '—')
    : typeof v === 'boolean' ? String(v)
    : Array.isArray(v) ? str(v) || '—' : v === '' || v == null ? '—' : String(v);
}

/* ---------- skip logic → expression ---------- */
const q = s => String(s).includes("'") ? `"${s}"` : `'${s}'`;
function skipToExpr(sl, info) {
  const cs = ((sl && sl.conditions) || []).filter(c => c.fieldId && info(c.fieldId));
  if (!cs.length) return '';
  const one = c => {
    const { name, multi } = info(c.fieldId), v = '${' + name + '}',
          raw = String(c.value == null ? '' : c.value),
          val = raw !== '' && !isNaN(raw) ? raw : q(raw);
    switch (c.operator) {
      case 'equals': return multi ? `selected(${v}, ${q(raw)})` : `${v} = ${val}`;
      case 'not_equals': return multi ? `not(selected(${v}, ${q(raw)}))` : `${v} != ${val}`;
      case 'greater_than': return `${v} > ${val}`;
      case 'less_than': return `${v} < ${val}`;
      case 'greater_equal': return `${v} >= ${val}`;
      case 'less_equal': return `${v} <= ${val}`;
      case 'contains': return `contains(${v}, ${q(raw)})`;
      case 'starts_with': return `starts-with(${v}, ${q(raw)})`;
      case 'ends_with': return `regex(${v}, ${q('.*' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')})`;
      case 'is_empty': return `${v} = ''`;
      case 'is_not_empty': return `${v} != ''`;
      case 'regex': return `regex(${v}, ${q(raw)})`;
    }
    return 'true()';
  };
  const e = cs.map(one).join(sl.logicalOperator === 'or' ? ' or ' : ' and ');
  return sl.action === 'show' ? e : `not(${e})`;
}
function relevantOf(f, info) {
  const parts = [skipToExpr(f.skipLogic, info), String(f.relevant || '').trim()].filter(Boolean);
  return parts.length > 1 ? parts.map(x => `(${x})`).join(' and ') : parts[0] || '';
}
const KW = new Set(['and', 'or', 'div', 'mod', 'true', 'false']);
function toXls(expr, names) {
  return String(expr || '').replace(/\$\{[^}]*\}|'[^']*'|"[^"]*"|[A-Za-z_][\w]*(?=\s*\()|[A-Za-z_]\w*/g,
    m => /^[$'"]/.test(m) || KW.has(m) || !names.has(m) ? m : '${' + m + '}');
}
const help = 'if(c,a,b) coalesce selected(${x},\'a\') count-selected(.) selected-at round int number string abs pow sqrt log10 min max sum count ' +
  'concat join substr string-length contains starts-with ends-with normalize-space regex(.,\'^\\d+$\') today() now() date() format-date(d,\'%Y-%m-%d\')';

window.ODK = { run, truth, error, show, relevantOf, skipToExpr, toXls, help };
})();
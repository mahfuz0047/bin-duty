// Data layer. Two backends behind one interface:
//  - local: localStorage on this device (demo mode, used until Supabase is configured)
//  - remote: Supabase REST, shared by every phone that opens the link
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const remote = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const LOCAL_KEY = 'bin-duty-data';
const LOG_LIMIT = 30;
const DEFAULT_PIN = '0000'; // the admin PIN until someone changes it

export const DEFAULT_CONFIG = {
  lists: {
    main: {
      label: 'Main house',
      members: ['Jaskiran', 'Andrew', 'Raheem', 'Ian', 'Mahfuz', 'Artem'],
      anchor: '2026-11-16',
      anchorIndex: 2, // Raheem has the week of Nov 16
    },
    basement: {
      label: 'Basement',
      members: ['Prience', 'Neil'],
      anchor: '2026-11-16',
      anchorIndex: 0,
    },
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------- local backend ----------

function readLocal() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (raw && raw.config) return raw;
  } catch { /* fall through to defaults */ }
  return { config: clone(DEFAULT_CONFIG), weeks: {}, log: [] };
}

function writeLocal(data) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ }
}

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`bin-duty:${text}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const local = {
  async load() { return readLocal(); },
  async checkPin(pin) {
    return (readLocal().pinHash || await sha256(DEFAULT_PIN)) === await sha256(pin);
  },
  async changePin(oldPin, newPin) {
    if (!(await local.checkPin(oldPin))) return false;
    const data = readLocal();
    data.pinHash = await sha256(newPin);
    writeLocal(data);
    return true;
  },
  async saveConfig(config, pin) {
    if (!(await local.checkPin(pin))) throw new Error('That PIN is not right.');
    const data = readLocal();
    data.config = config;
    writeLocal(data);
  },
  async mutateWeek(key, fn) {
    const data = readLocal();
    data.weeks[key] = fn(data.weeks[key] || {});
    writeLocal(data);
  },
  async addLog(who, text) {
    const data = readLocal();
    data.log.unshift({ at: new Date().toISOString(), who, text });
    data.log = data.log.slice(0, LOG_LIMIT);
    writeLocal(data);
  },
};

// ---------- Supabase backend ----------

async function api(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Database error ${res.status}: ${await res.text()}`);
  const body = await res.text();
  return body ? JSON.parse(body) : null;
}

const upsert = (table, row) => api(table, {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(row),
});

// The PIN is checked inside the database, so the page never sees the stored hash.
const rpc = (fn, args = {}) => api(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

const supabase = {
  async load() {
    const [configRows, weekRows, logRows] = await Promise.all([
      api('bd_config?id=eq.1&select=data'),
      api('bd_weeks?select=key,data'),
      api(`bd_log?select=at,who,text&order=at.desc&limit=${LOG_LIMIT}`),
    ]);
    // Until an admin saves the names once, everyone sees the built-in lists.
    const config = configRows[0]?.data || clone(DEFAULT_CONFIG);
    const weeks = {};
    for (const row of weekRows) weeks[row.key] = row.data;
    return { config, weeks, log: logRows };
  },
  async checkPin(pin) { return Boolean(await rpc('bd_check_pin', { pin })); },
  async changePin(oldPin, newPin) {
    return Boolean(await rpc('bd_change_pin', { old_pin: oldPin, new_pin: newPin }));
  },
  async saveConfig(config, pin) {
    const ok = await rpc('bd_save_config', { pin, new_data: config });
    if (!ok) throw new Error('That PIN is not right.');
  },
  async mutateWeek(key, fn) {
    // Re-read the row first so two phones editing the same week don't clobber each other.
    const rows = await api(`bd_weeks?key=eq.${encodeURIComponent(key)}&select=data`);
    await upsert('bd_weeks', { key, data: fn(rows[0]?.data || {}) });
  },
  async addLog(who, text) {
    await api('bd_log', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ who, text }),
    });
  },
};

const backend = remote ? supabase : local;

export const load = () => backend.load();
export const saveConfig = (config, pin) => backend.saveConfig(config, pin);
export const changePin = (oldPin, newPin) => backend.changePin(oldPin, newPin);
export const checkPin = (pin) => backend.checkPin(pin);
export const mutateWeek = (key, fn) => backend.mutateWeek(key, fn);
export const addLog = (who, text) => backend.addLog(who, text);

/** Call `onChange` whenever another phone (or tab) may have changed the data. */
export function watch(onChange) {
  if (remote) {
    setInterval(() => { if (!document.hidden) onChange(); }, 20000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) onChange(); });
  } else {
    window.addEventListener('storage', (e) => { if (e.key === LOCAL_KEY) onChange(); });
  }
}

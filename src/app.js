// App state, data refresh and the handlers behind every data-action button.
import * as store from './store.js';
import { todayISO, currentMonday, weekKey, fmtShort } from './schedule.js';
import { renderApp, weekInfo } from './views.js';

const ME_KEY = 'bin-duty-me';
const GUEST_KEY = 'bin-duty-guest';
const root = document.getElementById('app');

const state = {
  config: null, weeks: {}, log: [],
  me: readMe(), guest: readGuest(), tab: null, open: null, more: false,
  sheet: null, draft: null, error: '', pin: null, pinError: '', pinNote: '',
  today: todayISO(), current: null, remote: store.remote,
};

function readMe() {
  try { return JSON.parse(localStorage.getItem(ME_KEY) || 'null'); } catch { return null; }
}

function readGuest() {
  try { return localStorage.getItem(GUEST_KEY) === '1'; } catch { return false; }
}

function saveMe(me) {
  state.me = me;
  try {
    if (me) localStorage.setItem(ME_KEY, JSON.stringify(me)); else localStorage.removeItem(ME_KEY);
  } catch { /* storage unavailable: the choice lasts until the page closes */ }
}

function setGuest(on) {
  state.guest = on;
  try {
    if (on) localStorage.setItem(GUEST_KEY, '1'); else localStorage.removeItem(GUEST_KEY);
  } catch { /* storage unavailable */ }
}

const listOf =(name) => Object.keys(state.config.lists)
  .find((id) => state.config.lists[id].members.includes(name));

const typing = () => ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName);

function render() {
  root.innerHTML = renderApp(state);
}

async function refresh({ background = false } = {}) {
  try {
    const data = await store.load();
    Object.assign(state, { config: data.config, weeks: data.weeks, log: data.log, error: '' });
  } catch (err) {
    state.error = `Could not reach the shared data. ${err.message}`;
    if (!state.config) return;
  }
  state.today = todayISO();
  state.current = currentMonday(state.today);
  if (state.me && !listOf(state.me.name)) saveMe(null); // name was removed in setup
  if (!state.me && !state.guest && state.sheet !== 'setup') state.sheet = 'me'; // first visit: ask who this is
  if (!state.tab || !state.config.lists[state.tab]) state.tab = (state.me && listOf(state.me.name)) || 'main';
  // Don't wipe what someone is typing just because another phone changed something.
  if (!(background && (typing() || state.sheet))) render();
}

/** Apply a change to one week, record it in the activity log, and redraw. */
async function change(w, logText, fn) {
  await store.mutateWeek(w.key, (rec) => {
    fn(rec);
    rec.person = w.person;
    return rec;
  });
  await store.addLog(state.me.name, `${logText} (${fmtShort(w.pickup.date)})`);
  await refresh();
}

function needMe() {
  if (state.me) return true;
  state.sheet = 'me';
  render();
  return false;
}

const info = (d) => weekInfo(state, d.list, d.monday);

const actions = {
  tab(d) { state.tab = d.list; state.open = null; render(); },
  more() { state.more = !state.more; render(); },
  toggle(d) {
    const key = weekKey(d.list, d.monday);
    state.open = state.open === key ? null : key;
    render();
  },

  'open-me'() { state.sheet = 'me'; render(); },
  'close-sheet'() {
    if (state.sheet === 'me' && !state.me && !state.guest) return; // first visit: pick a name or "Just looking"
    state.sheet = null;
    state.draft = null;
    state.pin = null;
    render();
  },
  'set-me'(d) {
    if (d.name && !listOf(d.name)) return;
    saveMe(d.name ? { name: d.name } : null);
    setGuest(!d.name); // "Just looking" is remembered too, so the picker doesn't nag
    if (d.name) state.tab = listOf(d.name);
    state.sheet = null;
    render();
  },

  async cant(d) {
    const w = info(d);
    if (!needMe() || !w.isPerson) return;
    const on = d.value === 'on';
    await change(w, on ? "can't do their turn" : 'can do their turn after all', (rec) => {
      rec.cant = on;
      if (!on) delete rec.coverBy;
    });
  },
  async cover(d) {
    const w = info(d);
    if (!needMe() || !w.inList || w.isPerson) return;
    await change(w, `is covering for ${w.person}`, (rec) => { rec.coverBy = state.me.name; });
  },
  async uncover(d) {
    const w = info(d);
    if (!needMe() || w.rec.coverBy !== state.me.name) return;
    await change(w, `is no longer covering for ${w.person}`, (rec) => { delete rec.coverBy; });
  },

  'open-setup'() {
    state.pinError = '';
    state.sheet = 'pin';
    render();
    root.querySelector('.sheet input')?.focus();
  },
  async 'pin-submit'(d, el) {
    const pin = el.closest('.sheet').querySelector('input').value.trim();
    const fail = (message) => {
      state.pinError = message;
      render();
      root.querySelector('.sheet input')?.focus();
    };
    if (!/^\d{4,12}$/.test(pin)) return fail('Use 4 to 12 digits.');
    if (!(await store.checkPin(pin))) return fail('That PIN is not right.');
    state.pin = pin; // kept in memory only, until the sheet closes
    state.pinNote = '';
    state.draft = {};
    for (const [id, list] of Object.entries(state.config.lists)) {
      state.draft[id] = { members: [...list.members], current: weekInfo(state, id, state.current).person };
    }
    state.sheet = 'setup';
    render();
  },
  async 'pin-change'(d, el) {
    const next = el.closest('.pin-form').querySelector('input').value.trim();
    if (!/^\d{4,12}$/.test(next)) {
      state.pinNote = 'Use 4 to 12 digits.';
    } else if (await store.changePin(state.pin, next)) {
      state.pin = next;
      state.pinNote = 'PIN changed.';
      await store.addLog(state.me?.name || 'Someone', 'changed the admin PIN');
    } else {
      state.pinNote = 'The PIN could not be changed.';
    }
    render();
  },
  'setup-move'(d) {
    const { members } = state.draft[d.list];
    const i = Number(d.i);
    const j = i + Number(d.by);
    if (j < 0 || j >= members.length) return;
    [members[i], members[j]] = [members[j], members[i]];
    render();
  },
  'setup-remove'(d) {
    const draft = state.draft[d.list];
    if (draft.members.length <= 1) return;
    const [gone] = draft.members.splice(Number(d.i), 1);
    if (draft.current === gone) [draft.current] = draft.members;
    render();
  },
  'setup-add'(d, el) {
    const name = el.closest('.add').querySelector('input').value.trim().slice(0, 30);
    const taken = Object.values(state.draft).some((l) => l.members.includes(name));
    if (!name || taken) return;
    state.draft[d.list].members.push(name);
    render();
  },
  async 'setup-save'() {
    const config = { lists: {} };
    for (const [id, d] of Object.entries(state.draft)) {
      config.lists[id] = {
        label: state.config.lists[id].label,
        members: d.members,
        anchor: state.current, // re-anchor on this week so the chosen person keeps it
        anchorIndex: Math.max(0, d.members.indexOf(d.current)),
      };
    }
    await store.saveConfig(config, state.pin);
    state.pin = null;
    await store.addLog(state.me?.name || 'Someone', 'updated the names and order');
    state.sheet = null;
    state.draft = null;
    await refresh();
  },
};

root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  const handler = el && actions[el.dataset.action];
  if (!handler) return;
  try {
    await handler(el.dataset, el);
  } catch (err) {
    state.error = `That did not save. ${err.message}`;
    render();
  }
});

root.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.matches('.pin-form input')) return;
  e.target.closest('.pin-form, .sheet').parentElement
    .querySelector('[data-action="pin-change"], [data-action="pin-submit"]')?.click();
});

root.addEventListener('change', (e) => {
  const id = e.target.dataset?.setupCurrent;
  if (id && state.draft) state.draft[id].current = e.target.value;
});

store.watch(() => refresh({ background: true }));
refresh();

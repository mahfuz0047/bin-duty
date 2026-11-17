// Pure HTML rendering. Every function takes state and returns a string;
// buttons carry data-action attributes that app.js handles.
import {
  BINS, pickupFor, assigneeFor, weekKey, addDays, fmtShort, fmtLong, fmtStamp, relative,
} from './schedule.js';

const APP_START = '2026-11-16'; // first week tracked in the app

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** Everything the UI needs to know about one list's week. */
export function weekInfo(s, listId, monday) {
  const list = s.config.lists[listId];
  const key = weekKey(listId, monday);
  const rec = s.weeks[key] || {};
  const person = (monday < s.current && rec.person) || assigneeFor(list, monday);
  const doer = rec.coverBy || person;
  const me = s.me?.name;
  return {
    listId, list, key, monday, rec, person, doer,
    pickup: pickupFor(monday),
    mine: Boolean(me && me === doer),
    isPerson: Boolean(me && me === person),
    inList: Boolean(me && list.members.includes(me)),
  };
}

const at = (w) => `data-list="${w.listId}" data-monday="${w.monday}"`;

// The city calendar's own icons, cut from its legend (icons/*.png, 97px tall).
const ICON_WIDTH = { green: 71, garbage: 75, recycling: 103, yard: 106 };
const binIcon = (b) => `<img class="bin-icon" src="icons/${b}.png" width="${ICON_WIDTH[b]}" height="97" alt="">`;

const binChips =(bins) => `<ul class="bins">${bins.map((b) => (
  `<li class="tag tag-out bin">${binIcon(b)}${BINS[b]}</li>`
)).join('')}</ul>`;

const binDots = (bins) => `<span class="dots" role="img" aria-label="${bins.map((b) => BINS[b]).join(', ')}">${
  bins.map(binIcon).join('')}</span>`;

function cantBlock(w) {
  const { rec } = w;
  if (rec.coverBy) {
    return `<div class="notice"><p><b>${esc(rec.coverBy)}</b> is covering for ${esc(w.person)}.</p>
      ${w.mine ? `<button type="button" class="link" data-action="uncover" ${at(w)}>I can't cover after all</button>` : ''}</div>`;
  }
  if (rec.cant) {
    return `<div class="notice"><p><b>${esc(w.person)}</b> can't do this one. Someone needs to cover.</p>
      ${w.inList && !w.isPerson ? `<button type="button" class="btn" data-action="cover" ${at(w)}>I'll cover it</button>` : ''}
      ${w.isPerson ? `<button type="button" class="link" data-action="cant" data-value="off" ${at(w)}>I can do it after all</button>` : ''}</div>`;
  }
  if (w.isPerson) {
    return `<button type="button" class="link quiet" data-action="cant" data-value="on" ${at(w)}>I can't do this week</button>`;
  }
  return '';
}

function nudgeLink(w) {
  const text = `Bin reminder: ${w.doer}, it's your turn. Pickup ${fmtShort(w.pickup.date)}: `
    + `${w.pickup.bins.map((b) => BINS[b]).join(', ')}. At the curb by 10am. ${location.origin}${location.pathname}`;
  return `<a class="btn btn-quiet btn-wide" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text)}">Remind in WhatsApp</a>`;
}

function currentCard(s, listId) {
  const w = weekInfo(s, listId, s.current);
  const p = w.pickup;
  const pickup = `Pickup is <time datetime="${p.date}">${fmtShort(p.date)}</time>, ${relative(p.date, s.today)}.`;
  return `<section class="now${w.mine ? ' mine' : ''}">
    <h2>${w.mine ? 'Your turn' : esc(w.doer || 'Nobody yet')}</h2>
    <p class="lede">${pickup}</p>
    ${p.holiday ? '<p class="notice">Holiday Monday. Pickup moves to <b>Tuesday</b> this week.</p>' : ''}
    ${p.estimated ? '<p class="notice">This date is past the end of the city calendar, so the bins shown are a guess.</p>' : ''}
    ${binChips(p.bins)}
    <p class="when">At the curb by 10:00am.</p>
    ${p.note ? `<p class="when">${esc(p.note)}</p>` : ''}
    ${cantBlock(w)}
    ${nudgeLink(w)}
  </section>`;
}

function upcoming(s, listId) {
  const count = s.more ? 26 : 6;
  const rows = [];
  for (let i = 1; i <= count; i += 1) {
    const w = weekInfo(s, listId, addDays(s.current, i * 7));
    const open = s.open === w.key;
    rows.push(`<li class="row${w.mine ? ' mine' : ''}${open ? ' open' : ''}">
      <button type="button" class="row-head" data-action="toggle" ${at(w)} aria-expanded="${open}">
        <span class="date">${fmtShort(w.pickup.date)}</span>
        <span class="who">${esc(w.doer)}</span>
        ${w.mine ? '<span class="tag tag-on">you</span>' : ''}
        ${w.pickup.holiday ? '<span class="tag tag-out">holiday</span>' : ''}
        ${w.rec.cant && !w.rec.coverBy ? '<span class="tag tag-on">needs cover</span>' : ''}
        ${w.rec.coverBy ? '<span class="tag tag-in">covered</span>' : ''}
        ${binDots(w.pickup.bins)}
      </button>
      ${open ? `<div class="row-body">${binChips(w.pickup.bins)}${cantBlock(w)}</div>` : ''}
    </li>`);
  }
  return `<section class="block"><h2>Coming up</h2><ul class="rows ruled">${rows.join('')}</ul>
    <button type="button" class="link" data-action="more">${s.more ? 'Show fewer' : 'Show next months'}</button></section>`;
}

function recent(s, listId) {
  const rows = [];
  for (let i = 1; i <= 4; i += 1) {
    const monday = addDays(s.current, -i * 7);
    if (monday < APP_START) break;
    const w = weekInfo(s, listId, monday);
    rows.push(`<li class="row"><div class="row-head">
      <span class="date">${fmtShort(w.pickup.date)}</span><span class="who">${esc(w.doer)}</span>
    </div></li>`);
  }
  return rows.length ? `<section class="block"><h2>Recent weeks</h2><ul class="rows ruled">${rows.join('')}</ul></section>` : '';
}

const activity = (s) => (s.log.length ? `<section class="block"><h2>Activity</h2><ul class="log ruled">${
  s.log.slice(0, 12).map((l) => `<li><b>${esc(l.who)}</b> ${esc(l.text)} <small>${fmtStamp(l.at)}</small></li>`).join('')
}</ul></section>` : '');

function meSheet(s) {
  return `<div class="sheet-back" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-label="Who are you?">
    <h2>Who are you?</h2><p class="lede">This phone will remember, so your turns are highlighted and your taps carry your name.</p>
    ${Object.values(s.config.lists).map((list) => `<h3>${esc(list.label)}</h3><div class="names">${
      list.members.map((n) => `<button type="button" class="btn btn-quiet${s.me?.name === n ? ' on' : ''}" data-action="set-me" data-name="${esc(n)}">${esc(n)}</button>`).join('')
    }</div>`).join('')}
    <div class="sheet-actions"><button type="button" class="link" data-action="set-me" data-name="">Just looking</button>
    ${s.me ? '<button type="button" class="link" data-action="close-sheet">Cancel</button>' : ''}</div>
  </div>`;
}

function pinSheet(s) {
  return `<div class="sheet-back" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-label="Admin PIN">
    <h2>Admin PIN</h2>
    <p class="lede">Changing the names and order needs the PIN.</p>
    <div class="pin-form"><label for="pin">PIN</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" ${s.pinError ? 'aria-invalid="true" aria-describedby="pin-help"' : ''}>
      <p class="help" id="pin-help" role="alert">${esc(s.pinError)}</p></div>
    <div class="sheet-actions"><button type="button" class="btn" data-action="pin-submit">Continue</button>
      <button type="button" class="link" data-action="close-sheet">Cancel</button></div>
  </div>`;
}

function setupSheet(s) {
  return `<div class="sheet-back" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-label="Names and order">
    <h2>Names and order</h2><p class="lede">Turns go down each list in order, one person per week, then start again.</p>
    ${Object.entries(s.draft).map(([id, d]) => `<div class="setup-list"><h3>${esc(s.config.lists[id].label)}</h3>
      <ol class="setup-rows">${d.members.map((n, i) => `<li><span>${esc(n)}</span>
        <button type="button" class="btn btn-quiet btn-small" data-action="setup-move" data-list="${id}" data-i="${i}" data-by="-1" aria-label="Move ${esc(n)} up">Up</button>
        <button type="button" class="btn btn-quiet btn-small" data-action="setup-move" data-list="${id}" data-i="${i}" data-by="1" aria-label="Move ${esc(n)} down">Down</button>
        <button type="button" class="btn btn-quiet btn-small" data-action="setup-remove" data-list="${id}" data-i="${i}" aria-label="Remove ${esc(n)}">Remove</button></li>`).join('')}</ol>
      <div class="add"><input type="text" name="new-${id}" autocomplete="off" maxlength="30" placeholder="Add a name" aria-label="Name to add to ${esc(s.config.lists[id].label)}">
        <button type="button" class="btn btn-quiet" data-action="setup-add" data-list="${id}">Add</button></div>
      <label class="pick">This week's turn
        <select name="current-${id}" data-setup-current="${id}">${d.members.map((n) => `<option${n === d.current ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>
      </label></div>`).join('')}
    <div class="setup-list"><h3>Admin PIN</h3>
      <div class="pin-form"><label for="new-pin">New PIN, 4 to 12 digits</label>
        <div class="add"><input id="new-pin" name="new-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12">
          <button type="button" class="btn btn-quiet" data-action="pin-change">Change PIN</button></div>
        <p class="help" role="status">${esc(s.pinNote)}</p></div></div>
    <div class="sheet-actions"><button type="button" class="btn" data-action="setup-save">Save</button>
      <button type="button" class="link" data-action="close-sheet">Cancel</button></div>
  </div>`;
}

export function renderApp(s) {
  const lists = s.config.lists;
  return `<header class="top">
      <div><h1>Bin duty</h1><p class="sub">${fmtLong(s.today)}</p></div>
      <button type="button" class="btn btn-quiet me" data-action="open-me">${s.me ? esc(s.me.name) : 'Who are you?'}</button>
    </header>
    <nav class="tabs" aria-label="Which list">${Object.entries(lists).map(([id, l]) => (
      `<button type="button" class="${s.tab === id ? 'on' : ''}" aria-current="${s.tab === id}" data-action="tab" data-list="${id}">${esc(l.label)}</button>`
    )).join('')}</nav>
    ${s.error ? `<p class="notice" role="alert">${esc(s.error)}</p>` : ''}
    ${currentCard(s, s.tab)}
    ${upcoming(s, s.tab)}
    ${recent(s, s.tab)}
    ${activity(s)}
    <footer><button type="button" class="link" data-action="open-setup">Edit names and order</button></footer>
    ${s.sheet === 'me' ? meSheet(s) : ''}${s.sheet === 'pin' ? pinSheet(s) : ''}${s.sheet === 'setup' ? setupSheet(s) : ''}`;
}

// js/app.js – Web App Controller

import {
  getSettings, saveSettings, getTokens, isTokenExpired, clearAll,
  getRedirectUri, redirectToGoogle, redirectToSalesforce, handleOAuthCallback,
} from './auth.js';
import { getUpcomingEvents, updateEventTitle, formatEventTime, getBaseTitle } from './gcal.js';
import { getCurrentUser, getMyAccounts, getMyOpportunities } from './salesforce.js';
import { suggestMatches } from './matching.js';

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  settings:      null,
  googleTokens:  null,
  sfTokens:      null,
  sfUserId:      null,
  events:        [],
  accounts:      [],
  opportunities: [],
  selections:    {}, // eventId → { type, id, name }
  optionMaps:    {}, // eventId → [{type, id, name, label}]
};

// ── Boot ──────────────────────────────────────────────────────────────────
async function init() {
  // Must run first — parses and wipes the OAuth code from the URL, exchanges for token
  let cb = null;
  try { cb = await handleOAuthCallback(); }
  catch (err) {
    console.error('OAuth callback error:', err);
    // Surface the error after state is loaded
  }

  state.settings     = getSettings();
  state.googleTokens = getTokens('google');
  state.sfTokens     = getTokens('sf');
  state.sfUserId     = localStorage.getItem('ea_sf_user_id');

  // After Salesforce redirect, fetch the SF user ID for SOQL queries
  if (cb?.provider === 'salesforce' && state.sfTokens) {
    try {
      const info    = await getCurrentUser(state.sfTokens.accessToken, state.sfTokens.instanceUrl);
      state.sfUserId = info.user_id;
      localStorage.setItem('ea_sf_user_id', info.user_id);
    } catch (e) {
      console.error('Could not fetch SF user info:', e);
    }
  }

  // Show redirect URI in settings panel
  const uri = getRedirectUri();
  document.getElementById('app-uri').textContent = uri;
  document.getElementById('sf-uri').textContent  = uri;

  loadSettingsForm();
  refreshBadges();

  const configured = state.settings?.googleClientId &&
                     state.settings?.sfClientId     &&
                     state.settings?.sfInstanceUrl;

  if (!configured) {
    openSettings();
    showPanel('auth');
    return;
  }

  const gOk = state.googleTokens && !isTokenExpired(state.googleTokens);
  const sOk = state.sfTokens     && !isTokenExpired(state.sfTokens);

  if (gOk && sOk) {
    showPanel('main');
    loadData();
  } else {
    showPanel('auth');
    updateAuthButtons(gOk, sOk);
  }
}

// ── Panels ────────────────────────────────────────────────────────────────
function showPanel(name) {
  document.getElementById('auth-panel').classList.toggle('hidden', name !== 'auth');
  document.getElementById('main-panel').classList.toggle('hidden', name !== 'main');
}

function openSettings()  { document.getElementById('settings-panel').classList.add('open');    }
function closeSettings() { document.getElementById('settings-panel').classList.remove('open'); }
function toggleSettings() {
  document.getElementById('settings-panel').classList.toggle('open');
  document.getElementById('settings-btn').classList.toggle('active');
}

function refreshBadges() {
  document.getElementById('google-badge').classList.toggle(
    'ok', !!(state.googleTokens && !isTokenExpired(state.googleTokens)));
  document.getElementById('sf-badge').classList.toggle(
    'ok', !!(state.sfTokens && !isTokenExpired(state.sfTokens)));
}

function updateAuthButtons(gOk, sOk) {
  if (gOk) markConnected('connect-google-btn', '✓ Google Connected');
  if (sOk) markConnected('connect-sf-btn',     '✓ Salesforce Connected');
}

function markConnected(id, label) {
  const b = document.getElementById(id);
  b.textContent = label;
  b.classList.add('connected');
  b.disabled = true;
}

// ── Settings form ─────────────────────────────────────────────────────────
function loadSettingsForm() {
  const s = state.settings || {};
  document.getElementById('f-google-id').value = s.googleClientId || '';
  document.getElementById('f-sf-url').value    = s.sfInstanceUrl  || '';
  document.getElementById('f-sf-id').value     = s.sfClientId     || '';
}

function saveSettingsFromForm() {
  const googleClientId = document.getElementById('f-google-id').value.trim();
  const sfInstanceUrl  = document.getElementById('f-sf-url').value.trim().replace(/\/$/, '');
  const sfClientId     = document.getElementById('f-sf-id').value.trim();

  if (!googleClientId || !sfInstanceUrl || !sfClientId) {
    setSettingsMsg('Please fill in all three fields.', 'err');
    return false;
  }
  if (!sfInstanceUrl.startsWith('https://')) {
    setSettingsMsg('Salesforce URL must start with https://', 'err');
    return false;
  }

  const settings = { googleClientId, sfInstanceUrl, sfClientId };
  saveSettings(settings);
  state.settings = settings;
  setSettingsMsg('Saved!', 'ok');
  return true;
}

function setSettingsMsg(msg, type) {
  const el = document.getElementById('settings-msg');
  el.textContent = msg;
  el.className   = type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; el.className = ''; }, 4000);
}

// ── Data loading ──────────────────────────────────────────────────────────
async function loadData() {
  const list = document.getElementById('events-list');
  list.innerHTML = '<p class="loading">Loading events and Salesforce data…</p>';

  try {
    const [events, accounts, opps] = await Promise.all([
      getUpcomingEvents(state.googleTokens.accessToken),
      getMyAccounts(state.sfTokens.accessToken, state.sfTokens.instanceUrl, state.sfUserId),
      getMyOpportunities(state.sfTokens.accessToken, state.sfTokens.instanceUrl, state.sfUserId),
    ]);
    state.events        = events;
    state.accounts      = accounts;
    state.opportunities = opps;
    state.selections    = {};
    state.optionMaps    = {};
    renderEvents();
  } catch (err) {
    list.innerHTML = `
      <div class="err-msg" style="max-width:640px;margin:40px auto">
        <strong>Failed to load:</strong> ${esc(err.message)}<br>
        <small>Check your credentials in Settings or reconnect.</small>
      </div>`;
  }
}

// ── Render ────────────────────────────────────────────────────────────────
function renderEvents() {
  const list = document.getElementById('events-list');

  if (!state.events.length) {
    list.innerHTML = '<p class="empty">No upcoming events in the next 7 days.</p>';
    return;
  }

  list.innerHTML = '';
  for (const ev of state.events) {
    const suggestions = suggestMatches(ev, state.accounts, state.opportunities);
    list.appendChild(buildCard(ev, suggestions));
  }
}

function buildCard(ev, suggestions) {
  const card = document.createElement('div');
  card.className = 'event-card';

  const timeStr     = formatEventTime(ev);
  const attendees   = ev.attendees || [];
  const attendeeStr = attendees.map(a => a.displayName || a.email).join(', ');

  // Index-based option map — avoids delimiter issues with names containing special chars
  const optMap = [
    { type: null, id: null, name: null,
      label: '— Select Account or Opportunity —' },
    ...state.accounts.map(a => ({
      type: 'account', id: a.Id, name: a.Name,
      label: `${a.Name}  (Account)`,
    })),
    ...state.opportunities.map(o => ({
      type: 'opportunity', id: o.Id, name: o.Name,
      accountName: o.Account?.Name || null,
      label: `${o.Name}${o.Account?.Name ? '  ·  ' + o.Account.Name : ''}  (Opp)`,
    })),
  ];
  state.optionMaps[ev.id] = optMap;

  const optHtml = optMap
    .map((o, i) => `<option value="${i}">${esc(o.label)}</option>`)
    .join('');

  const chipHtml = suggestions
    .map(s => `
      <button class="chip ${s.type}"
              data-type="${s.type}" data-id="${s.id}" data-name="${esc(s.name)}"
              title="${s.type === 'opportunity' && s.accountName ? esc(s.accountName) : esc(s.name)}">
        ${esc(s.name)}
      </button>`)
    .join('');

  card.innerHTML = `
    <div class="ev-title">
      <a href="${ev.htmlLink || '#'}" target="_blank" rel="noopener">
        ${esc(ev.summary || '(No title)')}
      </a>
    </div>
    <div class="ev-meta">
      <span class="ev-time">${timeStr}</span>
      ${attendees.length
        ? `<span title="${esc(attendeeStr)}">👥 ${attendees.length} attendee${attendees.length !== 1 ? 's' : ''}</span>`
        : ''}
    </div>
    <div class="suggest-wrap">
      ${suggestions.length
        ? `<div class="suggest-label">Suggestions</div><div class="chips">${chipHtml}</div>`
        : `<span class="no-suggest">No automatic suggestions — use the dropdown below</span>`}
    </div>
    <div class="attr-row">
      <select class="attr-select">${optHtml}</select>
      <button class="apply-btn">Apply</button>
    </div>`;

  // ── Chip → select sync ──
  card.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      card.querySelectorAll('.chip').forEach(c => c.classList.remove('sel'));
      chip.classList.add('sel');
      const { type, id, name } = chip.dataset;
      state.selections[ev.id] = { type, id, name };
      const idx = optMap.findIndex(o => o.type === type && o.id === id);
      if (idx >= 0) card.querySelector('select').value = String(idx);
    });
  });

  // ── Select → chip sync ──
  card.querySelector('select').addEventListener('change', e => {
    card.querySelectorAll('.chip').forEach(c => c.classList.remove('sel'));
    const opt = optMap[parseInt(e.target.value, 10)];
    if (opt?.type) {
      state.selections[ev.id] = { type: opt.type, id: opt.id, name: opt.name };
      const chip = card.querySelector(`.chip[data-id="${opt.id}"]`);
      if (chip) chip.classList.add('sel');
    } else {
      delete state.selections[ev.id];
    }
  });

  // ── Apply ──
  card.querySelector('.apply-btn').addEventListener('click', async function () {
    await applyAttribution(ev, card, this);
  });

  return card;
}

// ── Attribution ───────────────────────────────────────────────────────────
async function applyAttribution(ev, card, btn) {
  const sel = state.selections[ev.id];
  if (!sel?.name) { flash(btn, 'Select one first', 'err'); return; }

  const newTitle = `${getBaseTitle(ev.summary)} | ${sel.name}`;
  if (ev.summary === newTitle) { flash(btn, '✓ Already set', 'ok'); return; }

  btn.disabled    = true;
  btn.textContent = 'Updating…';

  try {
    await updateEventTitle(state.googleTokens.accessToken, ev.id, newTitle);
    ev.summary = newTitle;
    const link = card.querySelector('.ev-title a');
    link.textContent = newTitle;
    link.title       = newTitle;
    card.classList.add('attributed');
    flash(btn, '✓ Applied', 'ok', true);
  } catch (err) {
    flash(btn, 'Error', 'err', true);
    console.error('updateEventTitle:', err);
  }
}

function flash(btn, label, cls, reenable = false) {
  btn.textContent = label;
  btn.classList.add(cls);
  setTimeout(() => {
    btn.textContent = 'Apply';
    btn.classList.remove(cls);
    if (reenable) btn.disabled = false;
  }, 2500);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Event listeners ───────────────────────────────────────────────────────
document.getElementById('settings-btn').addEventListener('click', toggleSettings);

document.getElementById('save-btn').addEventListener('click', () => {
  if (!saveSettingsFromForm()) return;
  const gOk = state.googleTokens && !isTokenExpired(state.googleTokens);
  const sOk = state.sfTokens     && !isTokenExpired(state.sfTokens);
  if (!gOk || !sOk) {
    showPanel('auth');
    updateAuthButtons(gOk, sOk);
  }
  setTimeout(closeSettings, 1500);
});

document.getElementById('disconnect-btn').addEventListener('click', () => {
  clearAll();
  localStorage.removeItem('ea_sf_user_id');
  state.googleTokens = null;
  state.sfTokens     = null;
  state.sfUserId     = null;
  refreshBadges();
  showPanel('auth');
  // Reset auth button labels
  const gb = document.getElementById('connect-google-btn');
  gb.textContent = 'Connect Google Calendar';
  gb.classList.remove('connected'); gb.disabled = false;
  const sb = document.getElementById('connect-sf-btn');
  sb.textContent = 'Connect Salesforce';
  sb.classList.remove('connected'); sb.disabled = false;
  setSettingsMsg('Disconnected.', 'ok');
});

document.getElementById('connect-google-btn').addEventListener('click', async () => {
  const s = getSettings();
  if (!s.googleClientId) {
    showAuthError('Save your Google Client ID in Settings first.');
    openSettings(); return;
  }
  await redirectToGoogle(s.googleClientId);
});

document.getElementById('connect-sf-btn').addEventListener('click', async () => {
  const s = getSettings();
  if (!s.sfClientId || !s.sfInstanceUrl) {
    showAuthError('Save Salesforce settings first.');
    openSettings(); return;
  }
  await redirectToSalesforce(s.sfInstanceUrl, s.sfClientId);
});

document.getElementById('refresh-btn').addEventListener('click', loadData);

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── Go ────────────────────────────────────────────────────────────────────
init().catch(console.error);

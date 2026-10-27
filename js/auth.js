// js/auth.js – Web OAuth helpers (PKCE + Authorization Code flow)
// No client secret required. PKCE provides the same security guarantee
// without exposing credentials in the browser.

const GOOGLE_AUTH   = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN  = 'https://oauth2.googleapis.com/token';
const SF_AUTH_PATH  = '/services/oauth2/authorize';
const SF_TOKEN_PATH = '/services/oauth2/token';

const KEY_SETTINGS = 'ea_settings';
const KEY_GOOGLE   = 'ea_google_token';
const KEY_SF       = 'ea_sf_token';

// ── Storage ───────────────────────────────────────────────────────────────
export function getSettings() {
  try { return JSON.parse(localStorage.getItem(KEY_SETTINGS) || 'null') || {}; }
  catch { return {}; }
}

export function saveSettings(s) {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
}

export function getTokens(provider) {
  try { return JSON.parse(localStorage.getItem(provider === 'google' ? KEY_GOOGLE : KEY_SF)); }
  catch { return null; }
}

export function saveTokens(provider, tokens) {
  localStorage.setItem(provider === 'google' ? KEY_GOOGLE : KEY_SF, JSON.stringify(tokens));
}

export function clearAll() {
  localStorage.removeItem(KEY_GOOGLE);
  localStorage.removeItem(KEY_SF);
}

export function isTokenExpired(tokens) {
  if (!tokens?.accessToken) return true;
  if (!tokens.expiresAt)    return false;
  return Date.now() >= tokens.expiresAt - 60_000;
}

export function getRedirectUri() {
  return window.location.href.split('#')[0].split('?')[0];
}

// ── PKCE helpers ──────────────────────────────────────────────────────────
async function generatePKCE() {
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const hash = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(verifier));

  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return { verifier, challenge };
}

// ── Initiate auth ─────────────────────────────────────────────────────────
export async function redirectToGoogle(clientId) {
  const { verifier, challenge } = await generatePKCE();
  sessionStorage.setItem('pkce_v_g', verifier);

  window.location.href = `${GOOGLE_AUTH}?` + new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          getRedirectUri(),
    scope:                 'https://www.googleapis.com/auth/calendar.events',
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    access_type:           'online',
    prompt:                'select_account',
    state:                 'g',
  });
}

export async function redirectToSalesforce(instanceUrl, clientId) {
  const { verifier, challenge } = await generatePKCE();
  sessionStorage.setItem('pkce_v_sf', verifier);
  sessionStorage.setItem('pkce_sf_url', instanceUrl);

  window.location.href = `${instanceUrl}${SF_AUTH_PATH}?` + new URLSearchParams({
    client_id:             clientId,
    response_type:         'code',
    redirect_uri:          getRedirectUri(),
    code_challenge:        challenge,
    code_challenge_method: 'S256',
    state:                 'sf',
  });
}

// ── Handle OAuth callback ─────────────────────────────────────────────────
// Call once on page load. Returns { provider, tokens } or null.
// With PKCE the code arrives in the query string (?code=...), not the hash.
export async function handleOAuthCallback() {
  const p = Object.fromEntries(new URLSearchParams(window.location.search.slice(1)));

  // Wipe query string immediately so the auth code doesn't linger in history
  history.replaceState(null, '', window.location.pathname);

  if (p.error) {
    console.warn('OAuth error:', p.error, p.error_description);
    return null;
  }
  if (!p.code || !p.state) return null;

  const settings = getSettings();

  // ── Google ──
  if (p.state === 'g') {
    const verifier = sessionStorage.getItem('pkce_v_g');
    sessionStorage.removeItem('pkce_v_g');
    if (!verifier) return null;

    const res  = await fetch(GOOGLE_TOKEN, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code:          p.code,
        redirect_uri:  getRedirectUri(),
        client_id:     settings.googleClientId,
        code_verifier: verifier,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || 'Google token exchange failed');

    const tokens = {
      accessToken: data.access_token,
      expiresAt:   Date.now() + (data.expires_in || 3600) * 1000,
    };
    saveTokens('google', tokens);
    return { provider: 'google', tokens };
  }

  // ── Salesforce ──
  if (p.state === 'sf') {
    const verifier    = sessionStorage.getItem('pkce_v_sf');
    const instanceUrl = sessionStorage.getItem('pkce_sf_url') || settings.sfInstanceUrl;
    sessionStorage.removeItem('pkce_v_sf');
    sessionStorage.removeItem('pkce_sf_url');
    if (!verifier) return null;

    const res  = await fetch(`${instanceUrl}${SF_TOKEN_PATH}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code:          p.code,
        redirect_uri:  getRedirectUri(),
        client_id:     settings.sfClientId,
        code_verifier: verifier,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || 'Salesforce token exchange failed');

    const tokens = {
      accessToken: data.access_token,
      instanceUrl: data.instance_url || instanceUrl,
      expiresAt:   data.expires_in ? Date.now() + data.expires_in * 1000 : null,
    };
    saveTokens('sf', tokens);
    return { provider: 'salesforce', tokens };
  }

  return null;
}

// js/auth.js – Web OAuth helpers (implicit flow, no backend required)

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const SF_AUTH     = '/services/oauth2/authorize';

const KEY_SETTINGS = 'ea_settings';
const KEY_GOOGLE   = 'ea_google_token';
const KEY_SF       = 'ea_sf_token';

// ── Storage ──────────────────────────────────────────────────────────────
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
  return Date.now() >= tokens.expiresAt - 60_000; // 1-min buffer
}

// ── OAuth redirect URIs ───────────────────────────────────────────────────
// Must match what's registered in the OAuth app (no hash or query string)
export function getRedirectUri() {
  return window.location.href.split('#')[0].split('?')[0];
}

// ── Initiate auth ─────────────────────────────────────────────────────────
export function redirectToGoogle(clientId) {
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'token',
    redirect_uri:  getRedirectUri(),
    scope:         'https://www.googleapis.com/auth/calendar.events',
    prompt:        'select_account',
    state:         'g',
  });
  window.location.href = `${GOOGLE_AUTH}?${params}`;
}

export function redirectToSalesforce(instanceUrl, clientId) {
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'token',
    redirect_uri:  getRedirectUri(),
    state:         'sf',
  });
  window.location.href = `${instanceUrl}${SF_AUTH}?${params}`;
}

// ── Handle OAuth callback ─────────────────────────────────────────────────
// Call once on page load. Returns { provider, tokens } or null.
// Salesforce may return params in the hash OR the query string.
export function handleOAuthCallback() {
  const hashParams  = Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
  const queryParams = Object.fromEntries(new URLSearchParams(window.location.search.slice(1)));
  const p = { ...queryParams, ...hashParams }; // hash takes precedence

  // Wipe URL immediately so tokens don't linger in browser history
  history.replaceState(null, '', window.location.pathname);

  if (p.error) {
    console.warn('OAuth error:', p.error, p.error_description);
    return null;
  }
  if (!p.access_token) return null;

  // Identify which provider returned
  const isGoogle = p.state === 'g' || (p.scope?.includes('calendar'));
  const isSF     = p.state === 'sf' || !!p.instance_url;

  if (isGoogle) {
    const tokens = {
      accessToken: p.access_token,
      expiresAt:   Date.now() + parseInt(p.expires_in || '3600', 10) * 1000,
    };
    saveTokens('google', tokens);
    return { provider: 'google', tokens };
  }

  if (isSF) {
    const tokens = {
      accessToken: p.access_token,
      instanceUrl: p.instance_url || getSettings().sfInstanceUrl,
      expiresAt:   p.expires_in
        ? Date.now() + parseInt(p.expires_in, 10) * 1000
        : null,
    };
    saveTokens('sf', tokens);
    return { provider: 'salesforce', tokens };
  }

  return null;
}

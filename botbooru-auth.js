// The token belongs to this SillyTavern origin and browser profile only.
const STORAGE_KEY = 'botbooru_import_access_token';

export function getToken() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; }
    catch { return ''; }
}

export function clearToken() {
    try { localStorage.removeItem(STORAGE_KEY); }
    catch { /* Storage can be unavailable in private browsing. */ }
}

/**
 * ST's CORS proxy serializes parsed POST bodies as JSON regardless of content
 * type. Nest the form inside a form field name so that, after that serialization,
 * BotBooru's form parser still receives the exact username and password fields.
 * Only synthetic test credentials should be used in tests; never log the body.
 */
export function buildProxyLoginBody(username, password) {
    const fields = new URLSearchParams({ username, password });
    return new URLSearchParams([[`&${fields.toString()}&`, '1']]).toString();
}

export async function login(username, password, headers) {
    const response = await fetch('/proxy/https://botbooru.com/auth/token', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildProxyLoginBody(username, password),
        signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404 && (await response.clone().text()).includes('CORS proxy is disabled')) {
        throw new Error('Enable the SillyTavern CORS proxy to log in.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message;
        throw new Error(detail || `BotBooru login failed (HTTP ${response.status}).`);
    }
    if (typeof data?.access_token !== 'string' || !data.access_token) throw new Error('BotBooru did not return a login token.');
    try { localStorage.setItem(STORAGE_KEY, data.access_token); }
    catch { throw new Error('This browser could not save the BotBooru token. Check its storage settings.'); }
}

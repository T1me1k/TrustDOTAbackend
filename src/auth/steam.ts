import { createHash, randomBytes } from 'node:crypto';

export const STEAM_PROVIDER = 'https://steamcommunity.com/openid';
export const STEAM_ENDPOINT = 'https://steamcommunity.com/openid/login';
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function steamIdFromClaimedId(value: string): string | null {
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/.exec(value);
  return match?.[1] ?? null;
}

export function buildSteamRedirect(realm: string, returnUrl: string, state: string) {
  const callback = new URL(returnUrl);
  callback.searchParams.set('state', state);
  const query = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup',
    'openid.return_to': callback.toString(), 'openid.realm': realm,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return `${STEAM_ENDPOINT}?${query}`;
}

function normalizeEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value);
    if (url.search || url.hash || url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString();
  } catch {
    return null;
  }
}

export async function verifySteamResponse(query: Record<string, unknown>, returnUrl: string, fetcher: typeof fetch = fetch) {
  if (query['openid.mode'] !== 'id_res') return null;
  const claimed = String(query['openid.claimed_id'] ?? '');
  const steamId64 = steamIdFromClaimedId(claimed);
  if (!steamId64 || query['openid.identity'] !== claimed) return null;
  const expected = new URL(returnUrl); expected.searchParams.set('state', String(query.state ?? ''));
  if (
    query['openid.return_to'] !== expected.toString()
    || normalizeEndpoint(query['openid.op_endpoint']) !== normalizeEndpoint(STEAM_ENDPOINT)
  ) return null;
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (key.startsWith('openid.')) form.set(key, String(value));
  form.set('openid.mode', 'check_authentication');
  const response = await fetcher(STEAM_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  return response.ok && /(?:^|\n)is_valid:true(?:\n|$)/.test(await response.text()) ? steamId64 : null;
}

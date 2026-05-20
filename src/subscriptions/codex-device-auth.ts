/**
 * OpenAI Codex device code authorization flow.
 *
 * Implements the OAuth 2.0 device authorization grant flow for Codex
 * (chatgpt.com). The flow:
 *
 * 1. POST to `/api/accounts/deviceauth/usercode` to get a device code + user code
 * 2. User visits `https://auth.openai.com/codex/device` and enters the code
 * 3. Poll POST to `/api/accounts/deviceauth/token` until user completes
 *    (403/404 = pending)
 * 4. Exchange the authorization_code + code_verifier at `/oauth/token`
 *    for access/refresh tokens
 * 5. Refresh tokens via `/oauth/token` with `grant_type=refresh_token`
 */

// ── Constants ──

const AUTH_ORIGIN = 'https://auth.openai.com';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const VERIFICATION_URL = 'https://auth.openai.com/codex/device';
const DEFAULT_INTERVAL_MS = 5_000;
const MAX_WAIT_MS = 15 * 60 * 1_000;

// ── Types ──

export interface DeviceAuthSession {
  /** Server-assigned device auth identifier. */
  deviceAuthId: string;
  /** Human-readable code the user enters on the verification page. */
  userCode: string;
  /** Suggested polling interval in seconds. */
  intervalSeconds: number;
  /** URL the user visits to enter the code. */
  verificationUrl: string;
}

export interface CodexTokens {
  /** OAuth access token (Bearer). */
  accessToken: string;
  /** Refresh token for obtaining new access tokens. */
  refreshToken: string;
  /** Expiration timestamp in epoch milliseconds. */
  expiresAt: number;
  /** Optional OpenID Connect ID token. */
  idToken?: string;
}

// ── Helpers ──

/**
 * Sleep for the given number of milliseconds, respecting an AbortSignal.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Encode a plain object into an `application/x-www-form-urlencoded` body string.
 */
function urlEncodeBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// ── Exported Functions ──

/**
 * Initiate the device code authorization flow.
 *
 * POSTs to the device auth endpoint to obtain a device ID and user code.
 * The user must then visit the verification URL and enter the code.
 *
 * @param signal - Optional AbortSignal to cancel the request.
 * @returns A {@link DeviceAuthSession} with the auth ID, user code, and polling config.
 * @throws If the endpoint returns 404 (device auth unavailable), or any other error status.
 */
export async function initiateDeviceAuth(
  signal?: AbortSignal,
): Promise<DeviceAuthSession> {
  const url = `${AUTH_ORIGIN}/api/accounts/deviceauth/usercode`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID }),
    signal,
  });

  if (res.status === 404) {
    throw new Error('Device code login is not available on this auth server');
  }

  if (!res.ok) {
    throw new Error(
      `Device auth initiation failed: ${res.status} ${res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    device_auth_id: string;
    user_code: string;
    interval?: number | string;
  };

  const rawInterval = data.interval;
  let intervalSeconds = DEFAULT_INTERVAL_MS / 1000;

  if (rawInterval !== undefined && rawInterval !== null) {
    const parsed =
      typeof rawInterval === 'number' ? rawInterval : Number(rawInterval);
    if (!Number.isNaN(parsed) && parsed > 0) {
      intervalSeconds = parsed;
    }
  }

  return {
    deviceAuthId: data.device_auth_id,
    userCode: data.user_code,
    intervalSeconds,
    verificationUrl: VERIFICATION_URL,
  };
}

/**
 * Complete the device code authorization flow by polling for user approval
 * and exchanging the authorization code for tokens.
 *
 * Polls the token status endpoint until the user completes authorization
 * (403/404 = still pending), then exchanges the received authorization code
 * and PKCE verifier at the OAuth token endpoint for access/refresh tokens.
 *
 * @param session - The {@link DeviceAuthSession} returned by {@link initiateDeviceAuth}.
 * @param signal - Optional AbortSignal to cancel polling.
 * @returns A {@link CodexTokens} object with access token, refresh token, and expiry.
 * @throws If the user takes longer than 15 minutes to authorize, or on unexpected status codes.
 */
export async function completeDeviceAuth(
  session: DeviceAuthSession,
  signal?: AbortSignal,
): Promise<CodexTokens> {
  const pollUrl = `${AUTH_ORIGIN}/api/accounts/deviceauth/token`;
  const exchangeUrl = `${AUTH_ORIGIN}/oauth/token`;
  const startedAt = Date.now();

  // ── Polling loop ──
  let authorizationCode: string;
  let codeVerifier: string;

  // eslint-disable-next-line no-constant-condition -- polling loop
  while (true) {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= MAX_WAIT_MS) {
      throw new Error('Device code authorization timed out');
    }

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const res = await fetch(pollUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_auth_id: session.deviceAuthId,
        user_code: session.userCode,
      }),
      signal,
    });

    if (res.status === 403 || res.status === 404) {
      // Still pending - sleep and retry
      await delay(session.intervalSeconds * 1000, signal);
      continue;
    }

    if (res.status !== 200) {
      throw new Error(
        `Device auth poll failed: ${res.status} ${res.statusText}`,
      );
    }

    // 200 - user has authorized
    const pollData = (await res.json()) as {
      authorization_code: string;
      code_verifier: string;
      code_challenge: string;
    };

    authorizationCode = pollData.authorization_code;
    codeVerifier = pollData.code_verifier;
    break;
  }

  // ── Exchange authorization code for tokens ──
  const body = urlEncodeBody({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: authorizationCode,
    code_verifier: codeVerifier,
    redirect_uri: 'https://auth.openai.com/deviceauth/callback',
  });

  const exchangeRes = await fetch(exchangeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal,
  });

  const exchangeData = (await exchangeRes.json()) as {
    access_token: string;
    refresh_token: string;
    id_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  return {
    accessToken: exchangeData.access_token,
    refreshToken: exchangeData.refresh_token,
    expiresAt: Date.now() + exchangeData.expires_in * 1000,
    idToken: exchangeData.id_token,
  };
}

/**
 * Refresh an expired Codex access token using the refresh token.
 *
 * POSTs to the OAuth token endpoint with `grant_type=refresh_token`
 * to obtain a new access token (and optionally a new refresh token).
 *
 * @param refreshToken - The refresh token to use.
 * @param signal - Optional AbortSignal to cancel the request.
 * @returns A {@link CodexTokens} object with the new (or same) tokens.
 * @throws If the refresh request fails with a non-200 status.
 */
export async function refreshCodexToken(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<CodexTokens> {
  const url = `${AUTH_ORIGIN}/oauth/token`;

  const body = urlEncodeBody({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal,
  });

  if (!res.ok) {
    throw new Error(`Failed to refresh Codex token: ${res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    idToken: data.id_token,
  };
}

/**
 * Decode the `chatgpt_account_id` claim from a Codex JWT access token.
 * The JWT payload is the second base64url-encoded segment.
 * This is a pure decode — no signature verification (we trust our own token).
 * Returns the account ID string, or null if the claim is missing or the token is malformed.
 */
export function decodeCodexAccountId(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    return payload?.['https://api.openai.com/auth']?.chatgpt_account_id ?? null;
  } catch {
    return null;
  }
}

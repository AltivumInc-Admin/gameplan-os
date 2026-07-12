// Cognito session management, dependency-free: the three calls this app
// needs (sign in, complete the invitation's new-password challenge, refresh)
// are plain JSON POSTs to the cognito-idp endpoint, so no SDK is bundled and
// the sign-in screen keeps the app's own design.

const POOL_ID = (import.meta.env.VITE_COGNITO_POOL_ID as string) ?? ''
const CLIENT_ID = (import.meta.env.VITE_COGNITO_CLIENT_ID as string) ?? ''
const REGION = POOL_ID.split('_')[0] || 'us-east-1'
const ENDPOINT = `https://cognito-idp.${REGION}.amazonaws.com/`
const STORE = 'gp-session'

export interface Session {
  access: string
  refresh: string
  exp: number // epoch seconds when the access token expires
  email: string
}

export function cognitoConfigured(): boolean {
  return Boolean(POOL_ID && CLIENT_ID)
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORE)
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

function saveSession(s: Session) {
  localStorage.setItem(STORE, JSON.stringify(s))
}

export function clearSession() {
  localStorage.removeItem(STORE)
}

async function cognito(target: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const type = String(data.__type ?? '').split('#').pop()
    const message = String(data.message ?? type ?? 'sign in failed')
    throw new Error(
      type === 'NotAuthorizedException' || type === 'UserNotFoundException'
        ? 'Email or password not recognized.'
        : type === 'PasswordResetRequiredException'
          ? 'A password reset is required for this account.'
          : message,
    )
  }
  return data
}

interface AuthResult {
  AccessToken: string
  RefreshToken?: string
  ExpiresIn: number
}

function adopt(email: string, result: AuthResult, refreshFallback?: string) {
  saveSession({
    access: result.AccessToken,
    refresh: result.RefreshToken ?? refreshFallback ?? '',
    exp: Math.floor(Date.now() / 1000) + (result.ExpiresIn ?? 3600),
    email,
  })
}

export type SignInOutcome = { ok: true } | { ok: false; newPasswordSession: string }

// Returns ok, or the challenge session when the invitation's temporary
// password must be replaced before a session exists.
export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  const data = await cognito('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: { USERNAME: email, PASSWORD: password },
  })
  if (data.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
    return { ok: false, newPasswordSession: String(data.Session) }
  }
  adopt(email, data.AuthenticationResult as unknown as AuthResult)
  return { ok: true }
}

export async function completeNewPassword(
  email: string,
  newPassword: string,
  challengeSession: string,
): Promise<void> {
  const data = await cognito('RespondToAuthChallenge', {
    ChallengeName: 'NEW_PASSWORD_REQUIRED',
    ClientId: CLIENT_ID,
    Session: challengeSession,
    ChallengeResponses: { USERNAME: email, NEW_PASSWORD: newPassword },
  })
  adopt(email, data.AuthenticationResult as unknown as AuthResult)
}

export async function refreshSession(): Promise<boolean> {
  const s = getSession()
  if (!s?.refresh) return false
  try {
    const data = await cognito('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { REFRESH_TOKEN: s.refresh },
    })
    adopt(s.email, data.AuthenticationResult as unknown as AuthResult, s.refresh)
    return true
  } catch {
    return false
  }
}

// A valid access token, refreshing first when within a minute of expiry.
export async function accessToken(): Promise<string | null> {
  const s = getSession()
  if (!s) return null
  if (s.exp - Date.now() / 1000 < 60) {
    const refreshed = await refreshSession()
    if (!refreshed) return null
    return getSession()?.access ?? null
  }
  return s.access
}

export async function signOut(): Promise<void> {
  const s = getSession()
  clearSession()
  if (s?.refresh) {
    // Best-effort server-side revocation; local sign-out already happened.
    try {
      await cognito('RevokeToken', { Token: s.refresh, ClientId: CLIENT_ID })
    } catch {
      /* revocation is a courtesy; the session is gone locally */
    }
  }
}

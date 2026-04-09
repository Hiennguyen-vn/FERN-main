export const COOKIE_AUTH_TOKEN_SENTINEL = '__cookie_session__';

export function isCookieBackedSessionToken(token: string | null | undefined) {
  return token === COOKIE_AUTH_TOKEN_SENTINEL;
}

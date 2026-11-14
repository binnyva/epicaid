/**
 * Signed session cookies. The cookie holds the Reader id and an expiry, signed with
 * HMAC-SHA256 under AUTH_SECRET. No session table: signing out clears the cookie, and
 * removing a Reader (or their allow-list entry) takes effect on their next request.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "epicaid_session";
export const SESSION_DAYS = 30;
/** Holds the OAuth state and PKCE verifier between the redirect to Google and the callback. */
export const OAUTH_COOKIE = "epicaid_oauth";

export interface SessionPayload {
  readerId: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function encodeSession(payload: SessionPayload, secret: string): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function decodeSession(token: string | undefined, secret: string, now = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof payload.readerId !== "string" || typeof payload.exp !== "number") return null;
    return payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

export function newSession(readerId: string, now = Date.now()): SessionPayload {
  return { readerId, exp: Math.floor(now / 1000) + SESSION_DAYS * 24 * 3600 };
}

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is missing or shorter than 32 characters");
  return secret;
}

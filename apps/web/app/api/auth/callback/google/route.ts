/** Finishes Google sign-in: checks state, swaps the code for a token, checks the allow-list, sets the session. */
import { eq, schema } from "@epicaid/db";
import { NextResponse, type NextRequest } from "next/server";
import { isBootstrapAdmin, maySignIn, normaliseEmail } from "@/lib/access";
import { getDb } from "@/lib/db";
import { OAUTH_COOKIE, SESSION_COOKIE, SESSION_DAYS, authSecret, encodeSession, newSession } from "@/lib/session";

interface GoogleUser {
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

export async function GET(request: NextRequest) {
  const fail = (error: string) => {
    const response = NextResponse.redirect(new URL(`/sign-in?error=${error}`, request.nextUrl.origin));
    response.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
    return response;
  };
  const params = request.nextUrl.searchParams;
  const [state, verifier] = (request.cookies.get(OAUTH_COOKIE)?.value ?? "").split(".");
  if (!state || !verifier || params.get("state") !== state) return fail("state");
  const code = params.get("code");
  if (!code) return fail("cancelled");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: new URL("/api/auth/callback/google", request.nextUrl.origin).toString(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) return fail("google");
  const { access_token } = (await tokenResponse.json()) as { access_token?: string };
  const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!userResponse.ok) return fail("google");
  const user = (await userResponse.json()) as GoogleUser;
  if (!user.email || !user.email_verified) return fail("unverified");

  const email = normaliseEmail(user.email);
  const db = getDb();
  const allowed = await db.select().from(schema.allowedEmails).where(eq(schema.allowedEmails.email, email));
  if (!maySignIn(email, allowed.map((a) => a.email))) return fail("not-invited");

  const admin = isBootstrapAdmin(email);
  const [reader] = await db
    .insert(schema.readers)
    .values({ email, name: user.name, image: user.picture, isAdmin: admin })
    .onConflictDoUpdate({
      target: schema.readers.email,
      set: { name: user.name, image: user.picture, ...(admin ? { isAdmin: true } : {}) },
    })
    .returning({ id: schema.readers.id });
  if (!reader) return fail("google");

  const response = NextResponse.redirect(new URL("/", request.nextUrl.origin));
  response.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
  response.cookies.set(SESSION_COOKIE, encodeSession(newSession(reader.id), authSecret()), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
  return response;
}

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

const COOKIE_NAME = "porta_session";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET not set");
  return s;
}

function sign(payload: string): string {
  const mac = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verify(cookie: string): string | null {
  const dot = cookie.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = cookie.slice(0, dot);
  const mac = cookie.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return payload;
}

export async function isAdmin(): Promise<boolean> {
  const jar = await cookies();
  const c = jar.get(COOKIE_NAME)?.value;
  if (!c) return false;
  const payload = verify(c);
  if (!payload) return false;
  const [, ts] = payload.split(":");
  const age = Math.floor(Date.now() / 1000) - Number(ts);
  return age >= 0 && age < MAX_AGE;
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    throw new Error("Unauthorized");
  }
}

// Page-render guard. Server Components under admin/ must call this as their
// FIRST statement, before touching the database. The layout's isAdmin check
// does NOT cover them: Next renders layouts and pages in parallel, so a page's
// queries fire even when the layout is about to redirect an unauthenticated
// visitor. Left ungated, every anonymous hit to /admin runs those queries —
// which (with a database like Neon that scales to zero) keeps the compute
// awake and billing. redirect() throws NEXT_REDIRECT, aborting the render
// before any query runs; use this instead of the throwing requireAdmin() so an
// unauthenticated visitor lands on /login rather than an error boundary.
export async function requireAdminOrRedirect(): Promise<void> {
  if (!(await isAdmin())) redirect("/login");
}

export async function signInAdmin(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("ADMIN_PASSWORD not set");
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const payload = `admin:${Math.floor(Date.now() / 1000)}`;
  const cookie = sign(payload);
  const jar = await cookies();
  jar.set(COOKIE_NAME, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
    path: "/",
  });
  return true;
}

export async function signOutAdmin(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

export function newMagicToken(): string {
  return randomBytes(24).toString("base64url");
}

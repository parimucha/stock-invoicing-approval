import { cookies } from "next/headers";
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

export async function signInAdmin(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("ADMIN_PASSWORD not set");
  if (password !== expected) return false;
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

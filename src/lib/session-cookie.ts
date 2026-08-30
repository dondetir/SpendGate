import { cookies } from "next/headers";
import crypto from "node:crypto";
import { createSession, getSession, type Session } from "./store";

// Opaque, HMAC-signed session id in an httpOnly cookie. The cookie NEVER carries
// the role — role lives server-side in the store. A forged/tampered id fails the
// signature check and gets a fresh analyst session.

const COOKIE = "sg_sid";
const DEV_SECRET = "dev-secret-change-me";
const SECRET = process.env.SESSION_SECRET ?? DEV_SECRET;
const IS_PROD = process.env.NODE_ENV === "production";

function sign(id: string): string {
  const mac = crypto.createHmac("sha256", SECRET).update(id).digest("base64url");
  return `${id}.${mac}`;
}

function verify(value: string | undefined): string | null {
  if (!value) return null;
  const idx = value.lastIndexOf(".");
  if (idx < 0) return null;
  const id = value.slice(0, idx);
  const mac = value.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(id).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

export async function getOrCreateSession(): Promise<Session> {
  // Fail closed at request time (not build time) if prod is running the dev secret.
  if (IS_PROD && SECRET === DEV_SECRET) {
    throw new Error("SESSION_SECRET must be set in production (refusing the dev fallback).");
  }
  const store = await cookies();
  const id = verify(store.get(COOKIE)?.value);
  if (id) {
    return getSession(id) ?? createSession(id);
  }
  const newId = crypto.randomUUID();
  store.set(COOKIE, sign(newId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: IS_PROD,
    maxAge: 60 * 60 * 8, // 8h
  });
  return createSession(newId);
}

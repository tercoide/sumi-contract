// Signing in with Google (OpenID Connect, the authorization code flow with PKCE), for the company's accounts.
// No library: the program sends the person to Google, Google sends them back to /auth/callback with a code,
// and the server trades the code for the person's ID token straight with Google (over TLS, so the token needs no
// signature check: OpenID Connect Core 3.1.3.7). Who may come in: the accounts of the company's Google Workspace
// domains (the token's hd claim), and the addresses listed one by one.
//
// The keys: the OAuth client of the Google Cloud project (APIs & Services > Credentials > Create credentials >
// OAuth client ID > Web application; the authorized redirect URI is <url>/auth/callback). Either the JSON
// Google lets you download, saved as <data>/google-keys.json (SUMI_GOOGLE_KEYS to put it elsewhere), or
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Who may come in: <data>/login.json
// {"url": "https://...", "domains": ["company.com"], "allowed": ["someone@gmail.com"]}, or SUMI_URL,
// SUMI_DOMAINS and SUMI_ALLOWED (comma separated). Without keys there are no logins: the person is the
// computer's user (one person, on their own computer).
//
// Sessions last 30 days and survive restarts (<data>/sessions.json keeps a hash of each, not the cookie).

import crypto from "node:crypto";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { tr } from "../model/text.ts";

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  url: string; // where people reach the program: the redirect URI is url + /auth/callback
  domains: string[]; // Google Workspace domains whose accounts may come in
  allowed: string[]; // and these addresses
  admins: string[]; // addresses that are always administrators (and may come in): the first ones, before any role is given
  authUrl: string; // Google's (tests use their own)
  tokenUrl: string;
}

export interface Person {
  email: string;
  name: string;
  picture: string;
}

interface Session extends Person {
  expires: number; // ms
}

const SESSION_DAYS = 30;
const COOKIE = "sumi_session";
const STATE_COOKIE = "sumi_state";
const LOGIN_MINUTES = 10;

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : String(v ?? "").split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function readJson(file: string): Record<string, any> | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** The configuration, or null when there are no keys (no logins). Throws when there are keys but nobody may come in. */
export function loadAuth(dataDir: string, port: number, env = process.env): AuthConfig | null {
  const keysFile = env.SUMI_GOOGLE_KEYS || path.join(dataDir, "google-keys.json");
  const keys = readJson(keysFile);
  const k = keys?.web ?? keys?.installed ?? keys ?? {};
  const clientId = env.GOOGLE_CLIENT_ID || String(k.client_id ?? "");
  const clientSecret = env.GOOGLE_CLIENT_SECRET || String(k.client_secret ?? "");
  if (!clientId) return null;
  if (!clientSecret) throw new Error(`The Google client ${clientId} has no secret (GOOGLE_CLIENT_SECRET, or the JSON Google gives)`);
  const login = readJson(path.join(dataDir, "login.json")) ?? {};
  const c: AuthConfig = {
    clientId,
    clientSecret,
    url: String(env.SUMI_URL || login.url || `http://localhost:${port}`).replace(/\/+$/, ""),
    domains: list(env.SUMI_DOMAINS ?? login.domains),
    allowed: list(env.SUMI_ALLOWED ?? login.allowed),
    admins: list(env.SUMI_ADMINS ?? login.admins),
    authUrl: env.SUMI_GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: env.SUMI_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token",
  };
  if (!c.domains.length && !c.allowed.length && !c.admins.length)
    throw new Error("Google sign-in is set up but nobody may come in: list the company's domains, the addresses or the admins (login.json, SUMI_DOMAINS, SUMI_ALLOWED, SUMI_ADMINS)");
  return c;
}

const b64url = (b: Buffer) => b.toString("base64url");
const random = () => b64url(crypto.randomBytes(32));
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function cookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** May the person of these ID token claims come in? "" or why not */
export function checkClaims(c: AuthConfig, claims: Record<string, unknown>, nonce: string, now = Date.now(), known: (email: string) => boolean = () => false): string {
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") return "the token is not Google's";
  if (claims.aud !== c.clientId) return "the token is for another program";
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now - 60_000) return "the token has expired";
  if (claims.nonce !== nonce) return "the token is not this sign-in's";
  const email = String(claims.email ?? "").toLowerCase();
  if (!email || claims.email_verified !== true) return tr("Google hasn't verified the address &1.", email);
  const hd = String(claims.hd ?? "").toLowerCase();
  if (!(hd && c.domains.includes(hd)) && !c.allowed.includes(email) && !c.admins.includes(email) && !known(email)) return tr("&1 can't come in: it isn't an account of the company.", email);
  return "";
}

export class Auth {
  config: AuthConfig;
  private file: string;
  private sessions = new Map<string, Session>(); // by the cookie's hash
  private logins = new Map<string, { nonce: string; verifier: string; back: string; expires: number }>(); // by state

  /** Addresses the company added (its people, see roles): they may come in too */
  known: (email: string) => boolean = () => false;

  constructor(config: AuthConfig, dataDir: string) {
    this.config = config;
    this.file = path.join(dataDir, "sessions.json");
    const saved = readJson(this.file) ?? {};
    for (const [h, s] of Object.entries(saved)) if (s && s.expires > Date.now()) this.sessions.set(h, s as Session);
  }

  private save(): void {
    const temp = this.file + ".saving";
    fs.writeFileSync(temp, JSON.stringify(Object.fromEntries(this.sessions)), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  private get secure(): boolean {
    return this.config.url.startsWith("https:");
  }

  private cookie(name: string, value: string, seconds: number): string {
    return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${this.secure ? "; Secure" : ""}`;
  }

  /** The person signed in on this request, or null */
  person(req: http.IncomingMessage): Person | null {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    const s = this.sessions.get(hash(token));
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.sessions.delete(hash(token));
      this.save();
      return null;
    }
    return { email: s.email, name: s.name, picture: s.picture };
  }

  /** The /auth/ addresses: login, callback, logout. False if it isn't one of them. */
  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && url.pathname === "/auth/login") {
      this.login(url, res);
      return true;
    }
    if (req.method === "GET" && url.pathname === "/auth/callback") {
      await this.callback(req, url, res);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/auth/logout") {
      const token = cookies(req)[COOKIE];
      if (token && this.sessions.delete(hash(token))) this.save();
      res.writeHead(200, { "content-type": "application/json", "set-cookie": this.cookie(COOKIE, "", 0) });
      res.end('{"ok":true}');
      return true;
    }
    return false;
  }

  private login(url: URL, res: http.ServerResponse): void {
    const now = Date.now();
    for (const [k, v] of this.logins) if (v.expires < now) this.logins.delete(k);
    const state = random();
    const verifier = random();
    const nonce = random();
    const back = url.searchParams.get("back") ?? "";
    this.logins.set(state, { nonce, verifier, back: /^#\/[\w/-]*$/.test(back) ? back : "", expires: now + LOGIN_MINUTES * 60_000 });
    const q = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.url + "/auth/callback",
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    if (this.config.domains.length === 1 && !this.config.allowed.length) q.set("hd", this.config.domains[0]); // only a hint: checked again
    res.writeHead(302, { location: `${this.config.authUrl}?${q}`, "set-cookie": this.cookie(STATE_COOKIE, state, LOGIN_MINUTES * 60), "cache-control": "no-store" });
    res.end();
  }

  private async callback(req: http.IncomingMessage, url: URL, res: http.ServerResponse): Promise<void> {
    const state = url.searchParams.get("state") ?? "";
    const pending = this.logins.get(state);
    this.logins.delete(state);
    const fail = (why: string) => {
      res.writeHead(403, { "content-type": "text/html; charset=utf-8", "set-cookie": this.cookie(STATE_COOKIE, "", 0), "cache-control": "no-store" });
      res.end(page(tr("You couldn't sign in"), why));
    };
    if (url.searchParams.get("error")) return fail(tr("Google said: &1", url.searchParams.get("error")));
    if (!pending || pending.expires < Date.now() || cookies(req)[STATE_COOKIE] !== state) return fail(tr("The sign-in took too long or was started elsewhere: try again."));
    let claims: Record<string, unknown>;
    try {
      const r = await fetch(this.config.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: url.searchParams.get("code") ?? "",
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.url + "/auth/callback",
          grant_type: "authorization_code",
          code_verifier: pending.verifier,
        }),
      });
      const body = (await r.json()) as Record<string, unknown>;
      if (!r.ok || typeof body.id_token !== "string") return fail(tr("Google said: &1", String(body.error_description ?? body.error ?? r.status)));
      claims = JSON.parse(Buffer.from(body.id_token.split(".")[1] ?? "", "base64url").toString("utf8"));
    } catch (e) {
      return fail(tr("Google can't be reached: &1", e instanceof Error ? e.message : String(e)));
    }
    const why = checkClaims(this.config, claims, pending.nonce, Date.now(), this.known);
    if (why) return fail(why);
    const token = random();
    const email = String(claims.email).toLowerCase();
    this.sessions.set(hash(token), { email, name: String(claims.name ?? "") || email, picture: String(claims.picture ?? ""), expires: Date.now() + SESSION_DAYS * 86_400_000 });
    this.save();
    console.log(`sumi-contract: ${email} signed in`);
    res.writeHead(302, { location: "/" + pending.back, "set-cookie": [this.cookie(COOKIE, token, SESSION_DAYS * 86_400), this.cookie(STATE_COOKIE, "", 0)], "cache-control": "no-store" });
    res.end();
  }
}

function page(title: string, text: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>sumi-contract</title>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.3rem">${esc(title)}</h1><p>${esc(text)}</p><p><a href="/">${esc(tr("Back to sumi-contract"))}</a></p></body>`;
}

// Signing in with Google, against a fake Google: the redirect, the code traded for the ID token (with PKCE),
// who may come in, the session cookie, signing out. (The real Google is tried by hand: see src/server/auth.ts.)

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Auth, checkClaims, loadAuth, type AuthConfig } from "../src/server/auth.ts";

function listen(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  return new Promise((ok) => {
    const s = http.createServer(handler);
    s.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() }));
  });
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

test("the configuration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sumi-auth-"));
  assert.equal(loadAuth(dir, 8064, {}), null, "no keys: no logins");
  fs.writeFileSync(path.join(dir, "google-keys.json"), JSON.stringify({ web: { client_id: "id.apps.googleusercontent.com", client_secret: "s" } }));
  assert.throws(() => loadAuth(dir, 8064, {}), /nobody may come in/, "keys but nobody may come in");
  fs.writeFileSync(path.join(dir, "login.json"), JSON.stringify({ domains: ["Empresa.com.ar"], allowed: "a@gmail.com, b@gmail.com" }));
  const c = loadAuth(dir, 8064, {})!;
  assert.ok(c.clientId === "id.apps.googleusercontent.com" && c.url === "http://localhost:8064", "Google's JSON file");
  assert.deepEqual([c.domains, c.allowed], [["empresa.com.ar"], ["a@gmail.com", "b@gmail.com"]], "domains and addresses");
  assert.equal(loadAuth(dir, 8064, { SUMI_URL: "https://x.run.app/", SUMI_DOMAINS: "" , SUMI_ALLOWED: "c@gmail.com" })!.url, "https://x.run.app", "the environment wins");
  fs.rmSync(dir, { recursive: true });

  const now = Date.now();
  const claims = { iss: "https://accounts.google.com", aud: c.clientId, exp: now / 1000 + 600, nonce: "n", email: "Pepe@Empresa.com.ar", email_verified: true, hd: "empresa.com.ar" };
  assert.equal(checkClaims(c, claims, "n"), "", "a company account");
  assert.equal(checkClaims(c, { ...claims, hd: undefined, email: "a@gmail.com" }, "n"), "", "an address allowed");
  assert.ok(checkClaims(c, { ...claims, hd: undefined, email: "x@empresa.com.ar" }, "n"), "the domain is the token's hd, not the address's");
  assert.ok(checkClaims(c, { ...claims, hd: "other.com" }, "n"), "another domain");
  assert.ok(checkClaims(c, { ...claims, aud: "another" }, "n"), "another program's token");
  assert.ok(checkClaims(c, { ...claims, iss: "https://evil" }, "n"), "not Google's");
  assert.ok(checkClaims(c, { ...claims, exp: now / 1000 - 600 }, "n"), "expired");
  assert.ok(checkClaims(c, claims, "m"), "another sign-in's nonce");
  assert.ok(checkClaims(c, { ...claims, email_verified: false }, "n"), "an address Google hasn't verified");
});

test("signing in with a fake Google", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sumi-auth-"));
  let token: Record<string, unknown> = {};
  let challenge = "";
  let verifierOk = false;
  const google = await listen(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const q = new URLSearchParams(body);
    verifierOk = crypto.createHash("sha256").update(q.get("code_verifier") ?? "").digest("base64url") === challenge && q.get("client_secret") === "secret";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id_token: `${b64({ alg: "RS256" })}.${b64(token)}.sig` }));
  });
  const config: AuthConfig = { clientId: "cid", clientSecret: "secret", url: "", domains: ["empresa.com.ar"], allowed: [], authUrl: "https://accounts.google.com/o/oauth2/v2/auth", tokenUrl: google.url };
  const auth = new Auth(config, dir);
  const app = await listen(async (req, res) => {
    if (await auth.handle(req, res)) return;
    res.end(JSON.stringify(auth.person(req)));
  });
  config.url = app.url;
  const get = (p: string, cookie = "") => fetch(app.url + p, { redirect: "manual", headers: { cookie } });
  const cookieOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

  /** Starts a sign-in; Google will answer with these claims */
  const signIn = async (claims: Record<string, unknown>) => {
    const r = await get("/auth/login?back=" + encodeURIComponent("#/p/p-x/budget"));
    assert.equal(r.status, 302);
    const to = new URL(r.headers.get("location")!);
    assert.ok(to.origin === "https://accounts.google.com" && to.searchParams.get("redirect_uri") === app.url + "/auth/callback" && to.searchParams.get("hd") === "empresa.com.ar", "to Google, back to the callback");
    challenge = to.searchParams.get("code_challenge")!;
    token = { iss: "https://accounts.google.com", aud: "cid", exp: Date.now() / 1000 + 600, nonce: to.searchParams.get("nonce"), email_verified: true, ...claims };
    return { state: to.searchParams.get("state")!, cookie: cookieOf(r) };
  };

  let x = await signIn({ email: "pepe@empresa.com.ar", hd: "empresa.com.ar", name: "Pepe Argento" });
  let r = await get(`/auth/callback?code=c&state=${x.state}`, x.cookie);
  assert.equal(r.status, 302, "signed in");
  assert.ok(verifierOk, "the code traded with the PKCE verifier and the secret");
  assert.equal(r.headers.get("location"), "/#/p/p-x/budget", "back where they were");
  const session = cookieOf(r).split("; ").find((c) => c.startsWith("sumi_session="))!;
  assert.ok(r.headers.getSetCookie()[0].includes("HttpOnly") && r.headers.getSetCookie()[0].includes("SameSite=Lax"), "an HttpOnly cookie");
  assert.deepEqual(await (await get("/", session)).json(), { email: "pepe@empresa.com.ar", name: "Pepe Argento", picture: "" }, "the person");
  assert.equal(await (await get("/")).json(), null, "nobody without the cookie");
  assert.ok(!fs.readFileSync(path.join(dir, "sessions.json"), "utf8").includes(session.split("=")[1]), "the sessions file keeps a hash, not the cookie");
  assert.equal(new Auth(config, dir).person({ headers: { cookie: session } } as http.IncomingMessage)?.email, "pepe@empresa.com.ar", "sessions survive a restart");

  assert.equal((await get(`/auth/callback?code=c&state=${x.state}`, x.cookie)).status, 403, "a state is used once");
  x = await signIn({ email: "pepe@empresa.com.ar", hd: "empresa.com.ar" });
  assert.equal((await get(`/auth/callback?code=c&state=${x.state}`)).status, 403, "the state cookie of the browser that started it is needed");
  x = await signIn({ email: "someone@gmail.com" });
  r = await get(`/auth/callback?code=c&state=${x.state}`, x.cookie);
  assert.ok(r.status === 403 && (await r.text()).includes("someone@gmail.com"), "an account from outside the company can't come in");

  r = await fetch(app.url + "/auth/logout", { method: "POST", headers: { cookie: session } });
  assert.equal(await (await get("/", session)).json(), null, "signed out");

  app.close();
  google.close();
  fs.rmSync(dir, { recursive: true });
});

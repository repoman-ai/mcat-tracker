import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.argv[2] || 8914);
const credentialSalt = "BrowserMockCredentialSalt0123456789_-ABCDE";
let loginUsername = "study.runner";

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ sub: "00000000-0000-4000-8000-000000000001", email: "mock-owner@example.invalid", role: "authenticated", exp: expiresAt })}.mock`;
  return { access_token: accessToken, refresh_token: crypto.randomUUID(), expires_in: 3600, expires_at: expiresAt, token_type: "bearer", user: user() };
}

function user() {
  return { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "mock-owner@example.invalid", user_metadata: {}, app_metadata: { provider: "email", providers: ["email"] }, created_at: "2026-01-01T00:00:00.000Z" };
}

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const send = (response, status, body, type = "application/json") => {
  response.writeHead(status, { "Content-Type": type, "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Cache-Control": "no-store" });
  response.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
};

async function requestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  try { return JSON.parse(body || "{}"); } catch { return {}; }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  if (request.method === "OPTIONS") return send(response, 204, "", "text/plain");

  if (url.pathname === "/js/sync-config.js") {
    return send(response, 200, `export const SYNC_CONFIG = Object.freeze({ supabaseUrl: "http://localhost:${port}", supabasePublishableKey: "browser-mock-publishable-key" });`, "text/javascript");
  }
  if (url.pathname === "/functions/v1/credential-info") return send(response, 200, { credentialSalt, credentialVersion: 2 });
  if (url.pathname === "/functions/v1/identifier-login") {
    const body = await requestBody(request);
    const known = ["study.runner", "renamed.runner", "mock-owner@example.invalid"].includes(String(body.identifier).toLowerCase());
    return known && /^mm2\.[A-Za-z0-9_-]{43}$/.test(String(body.password))
      ? send(response, 200, { accessToken: session().access_token, refreshToken: session().refresh_token, expiresAt: session().expires_at })
      : send(response, 401, { error: "That email or username and PIN combination did not match." });
  }
  if (url.pathname === "/functions/v1/request-pin-reset") return send(response, 200, { message: "If that identifier matches the owner account, a reset link is on its way." });
  if (url.pathname === "/functions/v1/account-credentials") {
    const body = await requestBody(request);
    if (body.action === "set_username") {
      if (body.loginUsername === "taken.user") return send(response, 409, { error: "That sign-in username is unavailable." });
      loginUsername = body.loginUsername;
    }
    return send(response, 200, { loginUsername, credentialSalt, credentialVersion: 2, migrationState: "active" });
  }
  if (url.pathname === "/auth/v1/user" && request.method === "GET") return send(response, 200, user());
  if (url.pathname === "/auth/v1/user" && request.method === "PUT") return send(response, 200, user());
  if (url.pathname === "/auth/v1/logout") return send(response, 204, "", "text/plain");
  if (url.pathname === "/rest/v1/tracker_state" && request.method === "GET") return send(response, 200, []);
  if (url.pathname === "/rest/v1/tracker_state" && request.method === "POST") return send(response, 201, "", "text/plain");

  const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`) && target !== path.join(root, "index.html")) return send(response, 403, "Forbidden", "text/plain");
  try {
    const content = await fs.readFile(target);
    return send(response, 200, content, mime[path.extname(target)] || "application/octet-stream");
  } catch {
    return send(response, 404, "Not found", "text/plain");
  }
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`browser mock ready on ${port}\n`));

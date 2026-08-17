import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import { fakeCredentialSaltForSecret, hmacDigest, normalizeIdentifierValue } from "./security.js";

const DEFAULT_ORIGINS = [
  "https://repoman-ai.github.io",
  "http://localhost:8912",
  "http://127.0.0.1:8912",
];
const DEFAULT_REDIRECTS = [
  "https://repoman-ai.github.io/mcat-tracker/reset.html",
  "http://localhost:8912/reset.html",
  "http://127.0.0.1:8912/reset.html",
];

function csvEnv(name: string, fallback: string[]) {
  const configured = Deno.env.get(name)?.split(",").map((value) => value.trim()).filter(Boolean);
  return new Set(configured?.length ? configured : fallback);
}

export function requestOrigin(req: Request) {
  return req.headers.get("origin") || "";
}

export function isAllowedOrigin(req: Request) {
  return csvEnv("ALLOWED_ORIGINS", DEFAULT_ORIGINS).has(requestOrigin(req));
}

export function corsHeaders(req: Request) {
  const origin = requestOrigin(req);
  return {
    "Access-Control-Allow-Origin": isAllowedOrigin(req) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

export function preflight(req: Request) {
  if (req.method !== "OPTIONS") return null;
  return isAllowedOrigin(req)
    ? new Response(null, { status: 204, headers: corsHeaders(req) })
    : json(req, { error: "Request not allowed." }, 403);
}

export function requireBrowserPost(req: Request) {
  if (!isAllowedOrigin(req)) return json(req, { error: "Request not allowed." }, 403);
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  if (!configuredKeys("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY").includes(req.headers.get("apikey") || "")) {
    return json(req, { error: "Request not allowed." }, 401);
  }
  const size = Number(req.headers.get("content-length") || 0);
  if (size > 4096) return json(req, { error: "Request too large." }, 413);
  return null;
}

function configuredKeys(jsonName: string, legacyName: string) {
  const keys: string[] = [];
  const encoded = Deno.env.get(jsonName);
  if (encoded) {
    const values = Object.values(JSON.parse(encoded)).filter((value) => typeof value === "string") as string[];
    keys.push(...values);
  }
  const legacy = Deno.env.get(legacyName);
  if (legacy && !keys.includes(legacy)) keys.push(legacy);
  if (!keys.length) throw new Error(`Missing ${jsonName}.`);
  return keys;
}

function firstConfiguredKey(jsonName: string, legacyName: string) {
  const keys = configuredKeys(jsonName, legacyName);
  const encoded = Deno.env.get(jsonName);
  if (encoded) {
    const named = JSON.parse(encoded).default;
    if (typeof named === "string") return named;
  }
  return keys[0];
}

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    firstConfiguredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

export function publicAuthClient(authorization?: string) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    firstConfiguredKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: authorization ? { headers: { Authorization: authorization } } : undefined,
    },
  );
}

export async function keyedDigest(value: string) {
  const secret = Deno.env.get("ALIAS_HMAC_SECRET");
  if (!secret || secret.length < 32) throw new Error("ALIAS_HMAC_SECRET is not configured.");
  return hmacDigest(secret, value);
}

export async function fakeCredentialSalt(identifier: string) {
  const secret = Deno.env.get("ALIAS_HMAC_SECRET");
  if (!secret || secret.length < 32) throw new Error("ALIAS_HMAC_SECRET is not configured.");
  return fakeCredentialSaltForSecret(secret, identifier);
}

function clientAddress(req: Request) {
  return req.headers.get("cf-connecting-ip")
    || req.headers.get("x-real-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unavailable";
}

export async function enforceRateLimit(req: Request, endpoint: string, identifier: string, limit = 12) {
  const admin = adminClient();
  const keys = await Promise.all([
    keyedDigest(`${endpoint}|ip|${clientAddress(req)}`),
    keyedDigest(`${endpoint}|identifier|${identifier}`),
  ]);
  for (const key of keys) {
    const { data, error } = await admin.rpc("server_consume_edge_rate_limit", {
      p_rate_key: key,
      p_limit: limit,
      p_window_seconds: 600,
    });
    if (error) throw error;
    if (!data) return false;
  }
  return true;
}

export async function resolveIdentifier(identifier: string) {
  const { data, error } = await adminClient().rpc("server_resolve_account_identifier", { p_identifier: identifier });
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

export function normalizeIdentifier(value: unknown) {
  return normalizeIdentifierValue(value);
}

export function validRedirect(value: unknown) {
  const redirect = String(value ?? "");
  return csvEnv("ALLOWED_RECOVERY_REDIRECTS", DEFAULT_REDIRECTS).has(redirect) ? redirect : "";
}

export async function uniformDelay(startedAt: number, minimumMs = 275) {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

const RESERVED = new Set([
  "account", "admin", "administrator", "api", "auth", "email", "help", "login",
  "mail", "mcat", "me", "momentum", "null", "owner", "root", "security",
  "signin", "sign-in", "support", "supabase", "system", "undefined", "user",
  "username", "www",
]);

export function validateUsername(value) {
  const username = String(value ?? "").trim().toLowerCase();
  const valid = username.length >= 3
    && username.length <= 32
    && /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(username)
    && !/[._-]{2}/.test(username)
    && !RESERVED.has(username);
  return { valid, username };
}

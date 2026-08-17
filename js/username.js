export const MIN_LOGIN_USERNAME_LENGTH = 3;
export const MAX_LOGIN_USERNAME_LENGTH = 32;

const RESERVED_LOGIN_USERNAMES = new Set([
  "account", "admin", "administrator", "api", "auth", "email", "help", "login",
  "mail", "mcat", "me", "momentum", "null", "owner", "root", "security",
  "signin", "sign-in", "support", "supabase", "system", "undefined", "user",
  "username", "www",
]);

export function normalizeLoginUsername(value = "") {
  return String(value).trim().toLowerCase();
}

export function validateLoginUsername(value) {
  const username = normalizeLoginUsername(value);
  if (username.length < MIN_LOGIN_USERNAME_LENGTH || username.length > MAX_LOGIN_USERNAME_LENGTH) {
    return { valid: false, username, message: `Use ${MIN_LOGIN_USERNAME_LENGTH}–${MAX_LOGIN_USERNAME_LENGTH} characters.` };
  }
  if (username.includes("@")) return { valid: false, username, message: "A sign-in username cannot contain @." };
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(username)) {
    return { valid: false, username, message: "Use letters, digits, dots, underscores, or hyphens, beginning and ending with a letter or digit." };
  }
  if (/[._-]{2}/.test(username)) return { valid: false, username, message: "Do not put punctuation marks next to each other." };
  if (RESERVED_LOGIN_USERNAMES.has(username)) return { valid: false, username, message: "That sign-in username is reserved. Choose another." };
  return { valid: true, username, message: "" };
}

export function normalizeLoginIdentifier(value = "") {
  return String(value).trim().toLowerCase();
}

export function isEmailIdentifier(value = "") {
  return normalizeLoginIdentifier(value).includes("@");
}

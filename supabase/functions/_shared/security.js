function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function hmacDigest(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export function normalizeIdentifierValue(value) {
  return String(value ?? "").trim().toLowerCase().slice(0, 254);
}

export async function fakeCredentialSaltForSecret(secret, identifier) {
  return hmacDigest(secret, `fake-credential|${normalizeIdentifierValue(identifier)}`);
}

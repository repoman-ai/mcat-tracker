import { enforceRateLimit, fakeCredentialSalt, json, normalizeIdentifier, preflight, requireBrowserPost, resolveIdentifier, uniformDelay } from "../_shared/common.ts";

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const options = preflight(req);
  if (options) return options;
  const rejected = requireBrowserPost(req);
  if (rejected) return rejected;

  try {
    const identifier = normalizeIdentifier((await req.json()).identifier);
    const allowed = identifier && await enforceRateLimit(req, "credential-info", identifier, 20);
    const record = allowed ? await resolveIdentifier(identifier) : null;
    const credentialSalt = record?.credential_salt || await fakeCredentialSalt(identifier);
    await uniformDelay(startedAt);
    return json(req, { credentialSalt, credentialVersion: 2 }, allowed ? 200 : 429);
  } catch {
    await uniformDelay(startedAt);
    return json(req, { error: "The sign-in service is temporarily unavailable." }, 503);
  }
});

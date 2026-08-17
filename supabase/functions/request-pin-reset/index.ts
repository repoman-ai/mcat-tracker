import { enforceRateLimit, json, normalizeIdentifier, preflight, publicAuthClient, requireBrowserPost, resolveIdentifier, uniformDelay, validRedirect } from "../_shared/common.ts";

const GENERIC_RESPONSE = { message: "If that identifier matches the owner account, a reset link is on its way." };

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const options = preflight(req);
  if (options) return options;
  const rejected = requireBrowserPost(req);
  if (rejected) return rejected;

  try {
    const body = await req.json();
    const identifier = normalizeIdentifier(body.identifier);
    const redirectTo = validRedirect(body.redirectTo);
    const allowed = identifier && redirectTo && await enforceRateLimit(req, "request-pin-reset", identifier, 5);
    if (allowed) {
      const record = await resolveIdentifier(identifier);
      const email = record?.account_email || (identifier.includes("@") ? identifier : "unknown-account@example.invalid");
      await publicAuthClient().auth.resetPasswordForEmail(email, { redirectTo });
    }
    await uniformDelay(startedAt);
    return json(req, GENERIC_RESPONSE, allowed ? 200 : 429);
  } catch {
    await uniformDelay(startedAt);
    return json(req, GENERIC_RESPONSE);
  }
});

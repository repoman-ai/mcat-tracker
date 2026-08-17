import { enforceRateLimit, json, keyedDigest, normalizeIdentifier, preflight, publicAuthClient, requireBrowserPost, resolveIdentifier, uniformDelay } from "../_shared/common.ts";

const GENERIC_ERROR = "That email or username and PIN combination did not match.";

Deno.serve(async (req) => {
  const startedAt = Date.now();
  const options = preflight(req);
  if (options) return options;
  const rejected = requireBrowserPost(req);
  if (rejected) return rejected;

  try {
    const body = await req.json();
    const identifier = normalizeIdentifier(body.identifier);
    const password = String(body.password ?? "");
    const allowed = identifier && /^mm2\.[A-Za-z0-9_-]{43}$/.test(password)
      && await enforceRateLimit(req, "identifier-login", identifier, 12);
    if (!allowed) {
      await uniformDelay(startedAt);
      return json(req, { error: GENERIC_ERROR }, 429);
    }
    const record = await resolveIdentifier(identifier);
    // Unknown identifiers still exercise the same Auth password endpoint. The
    // keyed, invalid-domain address is deterministic but can never identify a
    // real account, keeping the practical response path uniform.
    const accountEmail = record?.account_email
      || `missing+${(await keyedDigest(`fake-auth-email|${identifier}`)).slice(0, 32)}@example.invalid`;

    const { data, error } = await publicAuthClient().auth.signInWithPassword({
      email: accountEmail,
      password,
    });
    await uniformDelay(startedAt);
    if (!record || error || !data.session) return json(req, { error: GENERIC_ERROR }, 401);
    return json(req, {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    });
  } catch {
    await uniformDelay(startedAt);
    return json(req, { error: GENERIC_ERROR }, 401);
  }
});

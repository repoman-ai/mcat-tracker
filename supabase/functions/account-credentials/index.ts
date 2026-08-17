import { adminClient, json, preflight, publicAuthClient, requireBrowserPost } from "../_shared/common.ts";
import { validateUsername } from "../_shared/username.js";

async function authenticatedUser(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return null;
  const { data, error } = await publicAuthClient(authorization).auth.getUser();
  return error ? null : data.user;
}

async function status(user: { id: string; email?: string }) {
  const { data, error } = await adminClient().rpc("server_account_credential_status", {
    p_user_id: user.id,
    p_email: String(user.email || "").toLowerCase(),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row ? {
    loginUsername: row.login_username,
    credentialSalt: row.credential_salt,
    credentialVersion: row.credential_version,
    migrationState: row.migration_state,
  } : { loginUsername: null, credentialSalt: null, credentialVersion: null, migrationState: "none" };
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  const rejected = requireBrowserPost(req);
  if (rejected) return rejected;

  const user = await authenticatedUser(req);
  if (!user?.id || !user.email) return json(req, { error: "Your session expired. Unlock this device again." }, 401);

  try {
    const body = await req.json();
    const action = String(body.action || "status");
    const admin = adminClient();

    if (action === "status") return json(req, await status(user));

    if (action === "begin") {
      const checked = validateUsername(body.loginUsername);
      if (!checked.valid) return json(req, { error: "That sign-in username is invalid or reserved." }, 400);
      const { error } = await admin.rpc("server_begin_account_migration", {
        p_user_id: user.id,
        p_email: user.email.toLowerCase(),
        p_login_username: checked.username,
      });
      if (error) return json(req, { error: error.code === "23505" ? "That sign-in username is unavailable." : "The sign-in username could not be saved." }, 409);
      return json(req, await status(user));
    }

    if (action === "set_username") {
      let username = null;
      if (body.loginUsername !== null) {
        const checked = validateUsername(body.loginUsername);
        if (!checked.valid) return json(req, { error: "That sign-in username is invalid or reserved." }, 400);
        username = checked.username;
      }
      const current = await status(user);
      if (current.migrationState === "none") return json(req, { error: "Set up a sign-in username first." }, 409);
      const { error } = await admin.rpc("server_set_account_username", { p_user_id: user.id, p_login_username: username });
      if (error) return json(req, { error: error.code === "23505" ? "That sign-in username is unavailable." : "The sign-in username could not be saved." }, 409);
      return json(req, await status(user));
    }

    if (action === "activate") {
      const current = await status(user);
      const password = String(body.password || "");
      if (!current.credentialSalt || !/^mm2\.[A-Za-z0-9_-]{43}$/.test(password)) return json(req, { error: "Credential activation failed safely. Retry setup." }, 400);
      const verified = await publicAuthClient().auth.signInWithPassword({ email: user.email.toLowerCase(), password });
      if (verified.error || !verified.data.session) return json(req, { error: "Credential activation failed safely. Retry setup." }, 400);
      const { error } = await admin.rpc("server_activate_account_credential", { p_user_id: user.id });
      if (error) throw error;
      return json(req, await status(user));
    }

    return json(req, { error: "Unsupported account action." }, 400);
  } catch {
    return json(req, { error: "The account service is temporarily unavailable." }, 503);
  }
});

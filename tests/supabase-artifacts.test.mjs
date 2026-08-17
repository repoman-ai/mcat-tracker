import assert from "node:assert/strict";
import fs from "node:fs/promises";

const read = (relative) => fs.readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const migration = await read("supabase/migrations/202608170001_private_account_credentials.sql");
const config = await read("supabase/config.toml");
const common = await read("supabase/functions/_shared/common.ts");
const credentialInfo = await read("supabase/functions/credential-info/index.ts");
const identifierLogin = await read("supabase/functions/identifier-login/index.ts");
const reset = await read("supabase/functions/request-pin-reset/index.ts");
const account = await read("supabase/functions/account-credentials/index.ts");

assert.match(migration, /create schema if not exists private/);
assert.match(migration, /revoke all on schema private from public, anon, authenticated/);
assert.match(migration, /create unique index[^;]+account_credentials_username_key/is);
assert.match(migration, /login_username = lower\(btrim\(login_username\)\)/);
assert.match(migration, /prevent_credential_salt_change/);
assert.match(migration, /after update of email on auth\.users/);
assert.match(migration, /migration_state in \('pending', 'active'\)/);
assert.match(migration, /revoke all on function public\.server_resolve_account_identifier\(text\) from public, anon, authenticated/);
assert.match(migration, /grant execute on function public\.server_resolve_account_identifier\(text\) to service_role/);
assert.doesNotMatch(migration, /grant\s+(select|all).*account_credentials.*(anon|authenticated)/i);

assert.match(config, /\[functions\.credential-info\]\s*verify_jwt = false/);
assert.match(config, /\[functions\.identifier-login\]\s*verify_jwt = false/);
assert.match(config, /\[functions\.request-pin-reset\]\s*verify_jwt = false/);
assert.match(config, /\[functions\.account-credentials\]\s*verify_jwt = false/);
assert.match(account, /auth\.getUser\(\)/);

assert.match(common, /ALIAS_HMAC_SECRET/);
assert.match(common, /ALLOWED_ORIGINS/);
assert.match(common, /req\.headers\.get\("apikey"\)/);
assert.match(common, /Cache-Control": "no-store"/);
assert.doesNotMatch(common, /Access-Control-Allow-Origin": "\*"/);
assert.match(credentialInfo, /fakeCredentialSalt/);
assert.match(identifierLogin, /fake-auth-email/);
assert.match(identifierLogin, /signInWithPassword/);
assert.match(identifierLogin, /if \(!record \|\| error \|\| !data\.session\)/);
assert.match(reset, /GENERIC_RESPONSE/);
assert.match(account, /auth\.getUser\(\)/);
assert.match(account, /server_activate_account_credential/);
assert.match(migration, /delete from private\.edge_rate_limits/);

for (const [name, source] of Object.entries({ common, credentialInfo, identifierLogin, reset, account })) {
  assert.doesNotMatch(source, /console\.(log|debug|info|warn|error)/, `${name} must not log request data or credentials`);
  assert.doesNotMatch(source, /service_role\s*[:=]\s*["'][A-Za-z0-9._-]+/i, `${name} must not embed a server key`);
}

console.log("Supabase migration, privacy boundary, CORS, and Edge Function artifact tests passed");

# Private sign-in username rollback and recovery

Never place an owner email, PIN, derived `mm1.…`/`mm2.…` password, session token, secret/service-role key, database password, or HMAC secret in commands saved to this repository, support messages, screenshots, or logs.

## Before any account migration

If no `private.account_credentials` row has ever been created, the static client can be rolled back first because legacy email + PIN is still the Auth credential. After the old client is live, remove the four Edge Functions, then reverse the SQL migration in a reviewed maintenance window. Take a database backup first. Dropping objects is intentionally not automated here.

## Pending migration

Do not delete a pending row based only on `migration_state`. Auth password rotation and the final state update are separate systems, so a lost response can leave Auth already using `mm2.…` while the row still says `pending`. Retry setup with the same PIN; the client tests `mm2.…` first, falls back to `mm1.…`, reuses the existing salt, and activates safely.

If retry is impossible, establish an email recovery session. The reset page fetches the pending salt by authenticated user ID, sets a new `mm2.…` credential, and activates the row. This does not alter tracker data.

## After activation

The private salt is now required for both email + PIN and username + PIN. Do not drop the credential row, private schema, credential-info/login functions, or email-sync trigger, and do not deploy a legacy-only reset page.

To return an account to legacy email salting, schedule an owner-authorized maintenance window:

1. Take a database backup and keep the current alias functions deployed.
2. While an authenticated recovery or owner session is active, calculate a new `mm1.…` password locally from the current Auth email and chosen PIN; never transmit or record the raw PIN.
3. Update the Auth password to that `mm1.…` value and verify legacy email + PIN in a fresh browser.
4. Only after that verification, delete the account credential row, deploy the legacy client/reset page, and remove the functions/schema if no migrated rows remain.

If any step fails, keep the private row and functions intact and resume with the `mm2.…` path. Username removal in the normal UI is not a rollback: it clears only `login_username` and deliberately retains the salt.

## Function-only incident response

If username setup must be paused, hide/disable only the authenticated editor or reject `begin`/`set_username`; keep `credential-info`, `identifier-login`, recovery, and the private rows available for already-migrated accounts. Rotating `ALIAS_HMAC_SECRET` changes fake salts and rate-limit fingerprints but not real account salts or passwords; rotate it only as an intentional incident-response action.

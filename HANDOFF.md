# HANDOFF — current verified state

This file is a convenience snapshot, not a source of truth. Always inspect the working tree, Git
index, live application, and Supabase project before continuing.

## September restart — August 31, 2026

The schedule now starts September 1: 145 days, 20 Tuesday–Monday weeks. Diagnostic September 5,
protected review September 6–7. All 83 chapters finish by November 16. Third-party FL October 10;
six official FL dates remain November 21, December 5/12/19 and January 2/9. There are 564 scheduled
UWorld questions and 600 Section Bank questions. No authentication, cloud data or saved progress was
reset. Date keys and exam IDs retain their existing format.

`study-guide.json` is the current guide source; `MCAT_Study_Plan_2026-09-01.md` and the matching `.docx`
are readable local copies. The standalone XLSX now has 145 dated rows and a `20-Week Tracker` tab.
Office files were regenerated with explicitly user-approved local Python libraries; independent
mistake-log, mastery and existing validation-list data were preserved. The source workbook is read
only for fields, lists and mastery topics, not website dates or progress. Original August files remain
archived. The builder is `scripts/build_restart_office.py` in the parent workspace. Workbook previews
and content checks passed; full Word pagination QA was unavailable because LibreOffice is absent.

Run `python3 -S scripts/generate_site_data.py` and `node --test tests/*.test.mjs` from this directory.
The restart-specific regression tests cover dates, coverage, holidays, exam review, UI and saved-state
preservation. Do not run the old August plan builders; they would restore obsolete assumptions.

## Project

`/Users/macbookpro/Documents/Claude/MCAT/mcat-tracker` is a static, no-build, local-first MCAT study
tracker. Browser state saves immediately to `localStorage`; an authenticated session merges it with
one owner-only row in Supabase.

Authentication accepts an owner email or optional private sign-in username plus a numeric PIN of at
least four digits. Legacy accounts use the email-salted `mm1.…` derivation. Configuring the first
sign-in username migrates Auth to `mm2.…`, derived from an immutable random private account salt.
The editable username is never the salt. Literal PINs and derived passwords must never be logged,
persisted, committed, or requested.

## PIN recovery is complete

- The lock screen includes **Forgot your PIN?**.
- `reset.html` and `js/reset.js` consume the Supabase recovery session, fetch credential status by
  authenticated user ID, derive an `mm2.…` replacement for migrated/pending accounts or `mm1.…` for
  legacy accounts, update Auth, sign out, and return to a fresh unlock screen.
- Expired or already-used links show a resend form.
- A real built-in-Supabase recovery email was received and the PIN change succeeded.
- Local state and the cloud row are not deleted by locking or resetting.
- PIN derivation accepts digits only and requires at least four digits.

## Display name and sign-in username

An optional display name lives at `state.settings.displayName` (32 characters, sanitized by
`sanitizeDisplayName` in `js/storage.js`). It is edited only from the unlocked app, in the **Your
account and sync** dialog, appears in the **Today** heading, syncs/merges with tracker settings, and
round-trips through JSON backups. It is cosmetic and plays no part in authentication.

The separate sign-in username is a normalized unique alias in `private.account_credentials`. It is
only managed from the unlocked dialog. First setup re-verifies the current PIN and uses a retryable
pending→active migration; rename/removal preserve the immutable salt and PIN. The lock screen says
**Email or username**, uses `autocomplete="username"`, and remembers the identifier actually used.

## Supabase state verified on August 17, 2026

- Project ref: `hqsfeunkuvzuhbivlyla`
- Project URL and the current browser-safe publishable key are present in `js/sync-config.js`.
- Exactly one corrected owner user exists.
- Public sign-ups are disabled and Confirm email is disabled.
- `tracker_state` exists, has RLS enabled, has three policies, and grants no table privileges to
  `anon`.
- One schema-v3 tracker row exists for the owner. The local tracker reports **All changes synced**.
- Built-in email delivery worked; custom SMTP is not configured.
- Site URL: `https://repoman-ai.github.io/mcat-tracker/`
- Allowed recovery redirects:
  - `https://repoman-ai.github.io/mcat-tracker/reset.html`
  - `http://localhost:8912/reset.html`
  - `http://127.0.0.1:8912/reset.html`

The private alias migration is live in the unexposed `private` schema. Browser roles have no schema or
wrapper-function privileges; only `service_role` can call the server wrappers. The server-only
`ALIAS_HMAC_SECRET` is stored in Supabase Function Secrets and is not in this repository.
`credential-info`, `identifier-login`, `request-pin-reset`, and `account-credentials` are deployed.
Gateway JWT verification is disabled because the dashboard switch is legacy-secret-only; the
authenticated function validates bearer tokens with Supabase Auth `getUser()` itself.

The owner completed the one-time username migration in Chrome. Username + PIN and email + PIN both
unlocked the deployed site successfully, and the lock screen remembered the username without exposing
the email. Unknown-identifier recovery and login responses were checked live with generic errors; no
real recovery email was sent during the final verification pass. The versioned SQL file was applied
through the Supabase SQL Editor because the CLI was unavailable locally; reconcile migration history
before a future `supabase db push`.

Supabase's built-in sender is adequate for occasional recovery when the owner email is a project-team
address, but it is best-effort and currently limited to two messages per hour. Custom SMTP is optional
for this one-user system and is useful only if dependable production delivery is important.

## Git state

The repository tracks `main` and `origin/main` at the public repository:
`https://github.com/repoman-ai/mcat-tracker`.

GitHub Pages is enabled from the root of `main` with HTTPS enforced:
`https://repoman-ai.github.io/mcat-tracker/`.

The final Pages deployment completed successfully. The live desktop lock screen, phone lock screen,
username editor, username + PIN login, email + PIN compatibility login, and expired-link recovery page
were verified with no browser warnings or errors and no horizontal overflow. Authenticated flows still
require the owner to type credentials directly; never request, retrieve, inspect, or log them.

## Verification commands

```bash
for file in js/*.js js/views/*.js; do node --check "$file" || exit 1; done
node tests/pin.test.mjs
node tests/username.test.mjs
node tests/account-auth.test.mjs
node tests/storage.test.mjs
node tests/sync-merge.test.mjs
node tests/export.test.mjs
node tests/ui-auth.test.mjs
node tests/supabase-artifacts.test.mjs
git diff --check
```

The local preview uses `http://localhost:8912/index.html`. If the server process is stale, restart it
from this directory without changing the port so the existing browser origin and local data remain
the same.

## Safety boundaries

- Never request or expose a service-role key, secret key, database password, account key, PIN,
  derived password, HMAC secret, or session token.
- The project URL and anon key in `js/sync-config.js` are intentionally browser-visible; RLS is the
  authorization boundary.
- Do not hand-edit `data/site-data.json`; regenerate it with `scripts/generate_site_data.py` after
  authoritative source changes.
- Only `mcat-tracker/` is intended for deployment. Do not include parent-workspace source documents.
- The `mm2.…` derived value is still a replayable password. TLS, strict CORS, no-store responses,
  generic failures, server throttles, and Auth limits reduce exposure but do not make it
  phishing-resistant.

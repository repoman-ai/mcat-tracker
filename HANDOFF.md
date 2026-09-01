# HANDOFF — current verified state

This file is a convenience snapshot, not a source of truth. Always inspect the working tree, Git
index, live application, and Supabase project before continuing.

## September restart — August 31, 2026

The schedule now starts September 1: 145 days, 20 Tuesday–Monday weeks. Diagnostic September 5,
protected review September 6–7. All 83 chapters finish by November 16. Third-party FL October 10;
six official FL dates remain November 21, December 5/12/19 and January 2/9. There are 484 scheduled
UWorld questions and 600 Section Bank questions. No authentication, cloud data or saved progress was
reset. Date keys and exam IDs retain their existing format.

`study-guide.json` is the current guide source; `MCAT_Study_Plan_2026-09-01.md` and the matching `.docx`
are readable local copies. The standalone XLSX now has 145 dated rows and a `20-Week Tracker` tab.
Office files were regenerated with explicitly user-approved local Python libraries; independent
mistake-log, mastery and existing validation-list data were preserved. The source workbook is read
only for fields, lists and mastery topics, not website dates or progress. Original August files remain
archived. The builder is `scripts/build_restart_office.py` in the parent workspace. Workbook previews
and content checks passed. The bundled runtime became available during the workload revision;
all 11 Word pages were rendered and visually checked, superseding the earlier pagination limitation.

Run `python3 -S scripts/generate_site_data.py` and `node --test tests/*.test.mjs` from this directory.
The restart-specific regression tests cover dates, coverage, holidays, exam review, UI and saved-state
preservation. Do not run the old August plan builders; they would restore obsolete assumptions.

The workload review distributes SBs in 20–30-question blocks through January 6. Weeks 8–11
have 50 SB questions each (Friday 20, Saturday 30) and no extra UWorld. Official-exam weeks
use early-week SB blocks; holidays/rest and full-length review have no extra quotas. Weekly
budgets are unchanged (426 total): low-bound overrun fails generation; midpoint/upper-bound
risks remain explicit in the Plan UI. Unknown modes fail before special-day branches. Source
hashes replace wall-clock generatedAt; unchanged inputs regenerate byte-identically. Mode
deduplication is display-only. Backup counts distinguish current schedule records and history.

## Past-due work and completion — August 31, 2026

Today now places a compact **Past due** list above the current assignment. It contains every
unfinished study row from the active schedule, oldest first, with dates, age labels, and 44px
check-off buttons. Its viewport stays 96px on short phones and grows to 180px when the screen has
room. **View all** opens the matching weeks in Plan; neither route silently caps the backlog. Rest days, exam days, placeholder days, and the after-plan view
continue to surface pending work. Rest/test-window rows themselves are not overdue tasks.

**Today → Completed** (`#today/completed`) lists all checked-off daily records, newest scheduled
date first, including read-only history outside the current schedule. Checked buttons reopen current-plan days;
notes, question counts and other fields remain intact. Plan day summaries also have check-off
buttons, and its **Past due** filter uses the same derivation. Completion offers a 10-second Undo
(paused while hovered/focused) plus Ctrl/⌘Z outside text editing, guarded against newer edits.
All normal save-success messages and cleanup are coupled to a successful local write. Failed writes
preserve forms and show only the error. Focus timers survive completion/sync rerenders, pause when
leaving Today, and resume on return instead of running invisibly.

Design decisions: oldest-first ordering; a bounded scroll area instead of three cards or a hidden
item cap; no age horizon; show unfinished work even on rest days without prescribing catch-up;
keep all planned study days in the momentum denominator (exclude rest and placeholder windows);
include Undo and reversible completion; scope to Today, Completed and Plan without extra global
nav badges. `deferred` remains unfinished, and there is no new skipped status. Check-off records
completion, not when studying actually happened, so no inferred `completedLate`/`completedOn`
fields were added. A small due-retest link shares Log's derivation; missing exam scores are not
treated as overdue tasks because the diagnostic is explicitly unscored.

`pendingRows` and `completedRows` in `js/data.js` derive UI from existing records. Daily writes use
real `updatedAt` timestamps and the existing per-day last-write-wins merge; date previews affect
eligibility only. Generated site data, schema version, auth, sync configuration and Supabase were
not changed. Regression coverage is in `tests/pending.test.mjs`.

Date previews are identified once in the topbar; the redundant in-view preview pill was intentionally
removed to keep the action above the phone navigation. Plan resolves the preview date once per render.
View-state restoration is isolated in `js/view-state.js`, preserving disclosure state, named scroll
areas, focus and window position rather than expanding an app-level list for each widget.

Verification: the full Node test run passes (33 checks, including the existing Python workload suite),
all modules pass syntax checks, and `git diff --check` is clean. A tracked-module-graph regression starts
at each entry point and verifies every relative import will be present in a Pages deployment.
Browser checks used an isolated synthetic account: 375×667, 1280×800 and 1440×900, longest
assignment titles, completion/Undo/reopen/reload, preserved notes/counts, Plan filtering, focus
timer continuity, rest days and 115 unfinished after-plan records. No horizontal overflow or
browser warnings/errors were observed. Screenshots and the test log are under ignored
`tests/output/`. Real multi-device Supabase sync was not exercised in this pass.

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

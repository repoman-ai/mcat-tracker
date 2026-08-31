# MCAT Momentum

A private, local-first, phone-first MCAT study tracker generated from the authoritative plan files in the parent directory. It answers **"what should I study right now?"** first, then keeps the complete 20-week schedule, study guide, exam tracker, mistake log, repair queue, and mastery checklist one tap away.

## September 1 restart

The current plan starts Tuesday, September 1, 2026. Diagnostic: Saturday, September 5; review: September 6–7. All 83 chapters remain scheduled, with a 26-hour launch and mostly 22–24-hour content weeks. August assignments are no longer part of the schedule. Browser/cloud records, logs, settings, exam IDs, and authentication are preserved.

The current guide comes from `study-guide.json`; `MCAT_Study_Plan_2026-09-01.docx` is the matching Word copy. The standalone XLSX was regenerated with the 145-day schedule and 20-week tracker. It supplies mistake-log fields, validation options and mastery topics to the website; website exports add current browser/cloud progress. The original August files are archived. Do not use the August DOCX dates.

No build step, no framework. Plain HTML, CSS, and ES modules. It always saves locally, and after you unlock it with a PIN it keeps the same progress on your phone and your computer.

---

## Daily use

1. Open the site. **Today** shows the next concrete action — assignment, chapter, mode, workload estimate, and practice target — without scrolling.
2. Tap **Start study block**, or open **Review assignment** for chapter subsections and the full study-mode instructions.
3. Tap **Mark complete** when the block is done.
4. Tap **Log** in the bottom bar to capture a missed, flagged, or guessed-correct question. Date, source, section, chapter, and topic are pre-filled from today's assignment, so only the error type and three short answers are left to type.
5. Check **Log → Repair** for retests that are due and the repeated patterns worth one repair plan.

### The five views

| View | What it holds |
| --- | --- |
| **Today** | Next action, workload, weekly momentum, carryover, exam countdown, optional 25-minute focus timer |
| **Plan** | Phase map, all 20 weeks, filters, complete daily detail, chapters and subsections. **Jump to week N** skips straight to the current week |
| **Exams** | Eight scheduled full-lengths, section and total trends, timing and review status, the plan's readiness rule, registered-date setting |
| **Log** | Five panels — Capture, Repair, Entries, Mastery, Export |
| **Guide** | The complete study guide with search, deep links, and accessible sections |

---

## Source of truth

`data/site-data.json` is a **generated artifact**. Do not edit it by hand.

Regenerate it after any authoritative source changes:

```bash
python3 scripts/generate_site_data.py
```

The generator reads only these files from the parent directory:

- `schedule.csv`
- `plan.json`
- `kaplan-mcat-books.md`
- `study-guide.json`
- `MCAT_520_Plus_Mistake_Log.xlsx`

It refuses to write output unless the sources pass every integrity check: the complete date range declared in `plan.json` (currently 145 continuous dated rows), no duplicate or missing dates, 20 Tuesday–Monday weeks, all 83 chapter IDs resolving with no unknown IDs, weekly CARS and UWorld totals matching `plan.json`, eight Saturday full-lengths with two review days each, 200 Section Bank questions per science section, and complete guide/mastery coverage.

Files in `archive/` are superseded versions and are **not** sources.

Week 1 counts four warm-up CARS passages plus the nine-passage diagnostic. Thanksgiving and Christmas practice targets are redistributed away from the rest days. Weekly totals are reconciled at generation time.

### Placeholder exam dates

January 22–23, 2027 are **planning placeholders**, labelled as such everywhere they appear. The countdown says "Placeholder window" until you enter a real date under **Exams → Registered MCAT date**, after which it switches to "Registered MCAT" and counts to your actual date. That date syncs across your devices.

---

## Preview locally

```bash
python3 -m http.server 8912
```

Then open <http://localhost:8912/>. The site fetches `data/site-data.json`, so opening `index.html` straight from Finder is blocked by browser security — use the local server.

For date-specific checks, add `?today=YYYY-MM-DD` before the hash, e.g. `http://localhost:8912/?today=2026-11-26#today`. This only changes the displayed "today"; it never rewrites the schedule, and the interface labels itself as previewing.

Run the test suites:

```bash
node tests/pin.test.mjs
node tests/username.test.mjs
node tests/account-auth.test.mjs
node tests/storage.test.mjs
node tests/sync-merge.test.mjs
node tests/export.test.mjs
node tests/ui-auth.test.mjs
node tests/supabase-artifacts.test.mjs
```

---

## How saving works

**Local first, always.** Every change is written to this browser's `localStorage` before any network request. Studying never blocks on connectivity.

**Cloud second.** Once the device is unlocked, changes sync to one private Supabase row after a short debounce, on reconnect, when the tab becomes visible, and via **Sync now**. Sync status is shown as text plus a coloured dot — never colour alone — as one of: local only, locked, pending, syncing, synced, offline, or sync paused.

**Nothing is silently discarded.** Local and cloud states are merged record by record using per-record timestamps, so the newest edit to each daily record, exam, mistake, mastery topic, draft, and setting wins. Deleting a mistake writes a timestamped tombstone that syncs too, so a stale device can never resurrect a deleted entry. If stored JSON is ever unreadable, the original text is preserved under a recovery key and offered as a download rather than being deleted.

---

## Sign-in: email or username + PIN, with email recovery

This tracker is single-user. The gate is deliberately simple:

- **You unlock with an email or optional sign-in username plus a numeric PIN of at least four digits.** The identifier actually used is remembered on that device. If it was a username, the browser never replaces it with or exposes the associated email on the lock screen.
- **Your PIN is never stored or transmitted as typed.** It is stretched in the browser with PBKDF2-SHA256 (310,000 iterations) into a long `mm1.…` legacy or `mm2.…` migrated Supabase password. Only the derived password reaches authentication code, and it is never persisted or logged by the app.
- **New credentials use an immutable random salt.** The editable username is never a salt. Renaming or removing the username and changing the Auth email therefore leave the PIN credential unchanged.
- **The session persists.** Supabase refreshes it automatically, so in practice you type the PIN once per device and then just open the app. The PIN screen returns only on a new device, after clearing browser data, or when you tap **Lock this device**.
- **Offline never locks you out.** A device that has unlocked before stays unlocked with no connection, because a PIN cannot be verified offline. It re-locks on reconnect if the session has genuinely expired.
- **Locking is not deleting.** Locking ends cloud access on that device and leaves every local record intact.

Unknown emails, unknown usernames, and wrong PINs produce the same message. The pre-auth salt endpoint returns a keyed deterministic fake salt for unknown identifiers; the login endpoint also performs a fake Auth attempt, imposes per-IP and per-identifier server-side limits, and keeps response shape and minimum timing uniform. Strict CORS limits browser origins, although CORS is not authentication and non-browser clients can forge an Origin header. Supabase Auth rate limiting remains the password-attempt backstop; see [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).

### Display name versus sign-in username

Open the sync chip to reach **Your account and sync** after unlocking:

- **Display name** is an optional cosmetic greeting in `state.settings.displayName`. It is sanitized to 32 characters, syncs with tracker state, merges by the settings timestamp, and round-trips through JSON export/import. It never participates in authentication.
- **Sign-in username** is an optional private account alias. It is lowercase, unique after normalization, 3–32 ASCII characters, uses letters/digits/`.`/`_`/`-`, begins and ends alphanumerically, rejects adjacent punctuation and reserved names, and contains no `@`. It is stored with the private account credential, not in tracker state or backups.

The sign-in username editor is never rendered while locked. First setup requires the current PIN. Rename and removal do not rotate the password or salt; removal clears only the alias so email + PIN and recovery remain usable.

### First-time credential migration

Existing accounts remain compatible with the email-salted `mm1.…` flow until a sign-in username is configured. Setup first verifies the current `mm1.…` credential, creates one private pending record with a random immutable salt, derives `mm2.…` locally, and calls the vendored Supabase JS 2.111.0 `updateUser` API with `current_password`. The final activation verifies `mm2.…` before marking the record active.

The database transition is idempotent. A pending row is deliberately usable for credential lookup, and retries always reuse its salt. If creating the row, updating Auth, activating it, or returning any response fails, re-enter the same PIN and retry: the client detects whether Auth still accepts `mm1.…` or already accepts `mm2.…` and resumes at the safe point. Do not manually delete a pending record without first checking which password Auth accepts.

If you forget the PIN, **Forgot your PIN?** sends a one-use recovery link to the owner email. The request may start from either identifier but always returns a generic response. After the recovery session is established, the reset page privately obtains the account credential by authenticated user ID: migrated accounts derive the new password with the immutable salt, while legacy accounts keep the email-salted behavior. It then updates Supabase, activates a pending migration if necessary, signs out, and returns to a fresh unlock screen. Neither resetting nor locking deletes local or cloud tracker data.

### One-time setup

1. **Create a Supabase project** at <https://supabase.com>.

2. **Create the tracker table.** Open the project's SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql). This creates `tracker_state`, enables Row Level Security, revokes anonymous access, and grants each authenticated user access to only their row.

3. **Calculate your account key.** Serve the site locally and open [`setup.html`](./setup.html). Enter the email you will use and a PIN of at least four digits. It returns a long `mm1.…` string, computed entirely in your browser — nothing is transmitted. Copy it.

4. **Turn off public sign-ups.** In **Authentication → Sign In / Providers → Email**, disable **Allow new users to sign up**. Also disable **Confirm email**, since this account is created by hand and there is no in-app confirmation flow. The site has no registration form and never calls `signUp`.

5. **Create the one owner account.** In **Authentication → Users → Add user**, enter your email and paste the `mm1.…` value as the password. Tick "Auto Confirm User". This is the only account that will ever exist.

6. **Point the site at the project.** In **Project Settings → API**, copy the **Project URL** and the **publishable** (anon) key into [`js/sync-config.js`](./js/sync-config.js).

7. **Allow the recovery pages.** In **Authentication → URL Configuration**, set the deployed site as the Site URL and add both the deployed `reset.html` address and the local preview address to **Redirect URLs**.

8. **Deploy private-alias support.** Follow the safe deployment order below. Until those migrations and functions are deployed, legacy email + PIN remains the only supported login and the username editor will report that the account service is unavailable.

9. **Unlock.** Open the site, enter your email and PIN once, and it syncs. Then optionally configure a sign-in username inside **Your account and sync**.

### Signing in on a second device

Open the same URL and enter either the email or configured sign-in username plus the same PIN. Existing local progress on that device is **merged** with the cloud copy, never overwritten. After that first unlock the identifier actually used is remembered and only the PIN is asked for.

### If you forget the PIN

Tap **Forgot your PIN?** on the lock screen. Enter the owner email or configured username if this is a new device, then open
the link in the recovery email. Enter the new PIN twice. The reset page changes the derived Supabase
password and returns you to the tracker; unlock with the new PIN.

Supabase's built-in sender is best-effort, sends only to project-team addresses, and is currently
limited to two messages per hour. For this one-owner tracker, custom SMTP is optional as long as the
owner address is a project-team address and occasional recovery is enough. Configure custom SMTP
under **Authentication → Emails → SMTP Settings** only if recovery delivery needs production-grade
reliability or must work for a different address. The manual emergency fallback is to calculate a
new account key in `setup.html` and set that value on the owner user in the Supabase dashboard.
Neither method changes tracker data.

### Keys: what is safe to publish

| Value | Safe in a public repo? |
| --- | --- |
| Supabase **project URL** | Yes — it only identifies the project |
| Supabase **publishable / anon key** | Yes — it grants no data access on its own; RLS is the gate |
| Your **owner email** | Kept out anyway; typed per device |
| **Secret / service-role key** | **Never.** It bypasses RLS entirely |
| **Database password, access token, PIN, account key** | **Never** |

The publishable key is designed for browser code *provided Row Level Security is enabled*. The alias/email mapping instead lives in an unexposed `private` schema; public and authenticated browser roles receive no schema/table access. The SQL wrappers are executable only by `service_role` and are used only inside Edge Functions. This follows Supabase's guidance on [private schemas](https://supabase.com/docs/guides/database/tables#schemas) and [securing the Data API](https://supabase.com/docs/guides/api/securing-your-api).

### Safe alias deployment order

These are live mutations and must be reviewed immediately before execution:

1. Confirm legacy email + PIN login and recovery still work; take a database backup.
2. Apply [`supabase/migrations/202608170001_private_account_credentials.sql`](./supabase/migrations/202608170001_private_account_credentials.sql). Verify `private` is absent from **API → Exposed schemas**, browser roles cannot execute any `server_*` wrapper, and the Auth email-sync trigger exists.
3. In Edge Function secrets, add a new random `ALIAS_HMAC_SECRET` of at least 32 characters directly (never put it in a file, shell history, log, or documentation). Set `ALLOWED_ORIGINS` to the exact deployed and local origins and `ALLOWED_RECOVERY_REDIRECTS` to the exact deployed/local `reset.html` URLs.
4. Deploy `credential-info`, `identifier-login`, `request-pin-reset`, and `account-credentials` with [`supabase/config.toml`](./supabase/config.toml). Gateway JWT verification is disabled for all four because the dashboard toggle accepts only legacy-secret JWTs. Every endpoint still requires the project publishable key, and `account-credentials` additionally validates the caller's bearer token against Supabase Auth with `auth.getUser()` before serving any account data. Supabase documents the authorization-header pattern under [Edge Function authorization headers](https://supabase.com/docs/guides/functions/auth-headers).
5. With a nonexistent test identifier, verify credential-info has a stable response shape, repeated unknown requests receive the same salt, login/reset messages are generic, strict CORS rejects an unlisted origin, and rate limiting returns 429. Do not use the owner PIN or derived password in curl, logs, or test fixtures.
6. Publish the static client. Verify legacy email + PIN before configuring a username.
7. While signed in, configure the first username and re-enter the current PIN. Then verify username + PIN and email + PIN in fresh browser states, recovery, rename, and removal.

See [`supabase/ROLLBACK.md`](./supabase/ROLLBACK.md) before rollback. Most importantly, once any account is active on `mm2.…`, do not remove its private credential row or the credential/login functions and do not deploy a legacy-only client. The salt is then required to derive the real Auth password.

### Diagnosing paused sync

If the status reads **Sync paused**, open the sync panel for the reason. Local progress is never at risk while sync is paused — it keeps saving in the browser and uploads when the problem clears. Common causes: no network, an expired session (unlock again), or `sync-config.js` pointing at the wrong project. If you want a guaranteed-safe copy before troubleshooting, take a JSON backup first; it works offline and with sync disabled.

---

## Exports and backups

Everything is under **Log → Export**. All three work offline and none of them change your data.

**Excel workbook** — seven sheets (Daily Schedule, 20-Week Progress, Mistake Log, Weekly Pattern Review, High-Yield Mastery, Full-Length Scores, Lists), with frozen headers, autofilters, real date cells, wrapped long text, and no formulas to break. Generated locally with a vendored copy of ExcelJS.

**Mistake log CSV** — every field with stable headers, fully quoted, UTF-8 with BOM so Excel opens accents correctly. Commas, quotes, and newlines inside notes are escaped properly.

**JSON backup** — the complete, versioned round-trip format: all progress, exam records, mastery ratings, settings, registered exam date, unfinished form drafts, focus sessions, and deletion markers.

**Restoring** — choose a JSON file, and it is validated *before* anything changes. You pick **replace** or **merge**, you are offered a safety backup of your current state first, and you must confirm. An invalid or non-matching file is rejected with nothing altered.

XLSX and CSV are **portable reports, not sync formats**. There is no XLSX re-import; JSON is the supported full round trip. The website is the primary tracking source — there is no continuous in-place Excel sync.

---

## Deployment

The site is static and uses only relative paths, with `.nojekyll` included, so it works from a GitHub Pages project subpath.

**A private repository does not make a GitHub Pages site private.** On ordinary GitHub plans, publishing Pages from a private repo still serves the site publicly; access-controlled Pages requires GitHub Enterprise Cloud. This project is deployed on that understanding: the static interface and the generated study-plan JSON are public, while all personal progress lives behind PIN authentication and Row Level Security. If the study plan itself ever needs to be private, move to an access-controlled host rather than relying on repository visibility.

Only the `mcat-tracker/` directory is intended for deployment. The parent workspace holds the source `.docx` and `.xlsx` documents and is not part of the published site.

### Current live deployment

The private-schema migration and all four Edge Functions are deployed to the configured Supabase
project, and the static client is published at `https://repoman-ai.github.io/mcat-tracker/`. The
versioned SQL migration was applied through the Supabase SQL Editor in the reviewed order because the
Supabase CLI was unavailable locally; reconcile the project's migration history before a future
`supabase db push`. The `ALIAS_HMAC_SECRET` exists only in Supabase Function Secrets. No secret key,
PIN, derived password, session token, or recovery email contents were committed or documented.

---

## Architecture

```text
index.html            app shell, nav, dialog, PIN unlock gate
reset.html            email-link landing page for choosing a new PIN
setup.html            one-time account key calculator (never deployed data)
css/styles.css        mobile-first styles, one stylesheet
js/app.js             bootstrap, routing glue, sync chrome, unlock gate
js/data.js            loads and indexes site-data.json
js/storage.js         versioned local state, migration, merge, backups
js/account-auth.js    email/username unlock + retryable credential migration
js/username.js        login-username normalization and validation
js/sync.js            Supabase auth, Edge Function calls, debounced cloud sync
js/sync-config.js     project URL + publishable key (safe to publish)
js/pin.js             shared PIN → account-key derivation
js/reset.js           recovery-session handling and PIN update
js/router.js          hash routing
js/export.js          XLSX / CSV / JSON generation
js/views/             today, plan, exams, log, guide, shared
data/site-data.json   generated deployment artifact
favicon.svg           app icon (tabs, bookmarks) — generated, do not hand-edit
favicon.ico           legacy multi-size icon for older browsers
icons/                PWA + Apple touch icons for home-screen bookmarks
site.webmanifest      name, colours, and icons for installed/home-screen use
scripts/              site-data generator, icon generator
supabase/schema.sql   baseline tracker table + RLS policies
supabase/migrations/  versioned private credential schema and server-only SQL
supabase/functions/   pre-auth login/recovery and authenticated account endpoints
tests/                auth, migration, storage, merge, UI, and export suites
vendor/               ExcelJS 4.4.0, Supabase JS 2.111.0 (MIT, vendored)
```

No third-party code is loaded from a CDN at runtime.

### Icons

Every icon is generated from a single glyph definition in
`scripts/generate_icons.py`, so the tab favicon, the `.ico`, the Android
maskable icons, and the iOS touch icon can never drift apart:

```bash
python3 scripts/generate_icons.py bars    # bars | check | monogram | hex
```

Requires `cairosvg` and `pillow`. Re-run it after changing the glyph or the
palette, then commit the regenerated `favicon.svg`, `favicon.ico`, and
`icons/`. Adding the site to an iPhone home screen picks up
`icons/apple-touch-icon.png` and opens standalone, without browser chrome.

---

## Known limitations

- One authenticated cloud document rather than a relational backend. Fine for one user; it is not built for concurrent editing of the same record on two devices in the same second.
- Unfinished form **drafts** merge by whole-state recency rather than per-field, so a draft edited on two devices while both were offline keeps one side's version.
- No XLSX re-import. JSON is the dependable full-state import format.
- The cosmetic display name lives in `settings`, which merges as one block by recency, so changing it on two devices while both are offline keeps the newer edit rather than blending them. The private sign-in username does not live in tracker state.
- Workload estimates are labelled inferences from assignment type, mode, and targets — not measurements.
- Readiness output applies the plan's own rule and is presented as guidance, not a verdict.
- The focus timer is deliberately minimal: one optional 25-minute block with locally stored history.
- A four-digit PIN favors convenience over security. Client-side stretching protects the stored credential and Supabase rate-limits online attempts, but a longer PIN is safer and should be used if the site ever becomes multi-user or protects more sensitive data.
- The derived `mm2.…` value is the real Auth password. HTTPS, no-store responses, strict CORS, generic errors, endpoint throttling, and Auth limits reduce exposure, but a captured derived password can be replayed just like any other password. This design is not phishing-resistant; WebAuthn/passkeys would be required for that property.

# MCAT Momentum

A private, local-first, phone-first MCAT study tracker generated from the authoritative plan files in the parent directory. It answers **"what should I study right now?"** first, then keeps the complete 22-week schedule, study guide, exam tracker, mistake log, repair queue, and mastery checklist one tap away.

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
| **Plan** | Phase map, all 22 weeks, filters, complete daily detail, chapters and subsections. **Jump to week N** skips straight to the current week |
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
- `MCAT_Study_Plan_2026-08-19.docx`
- `MCAT_520_Plus_Mistake_Log.xlsx`

It refuses to write output unless the sources pass every integrity check: exactly 158 continuous dated rows, no duplicate or missing dates, 22 Wednesday–Tuesday weeks, all 83 chapter IDs resolving with no unknown IDs, weekly CARS and UWorld totals matching `plan.json`, the full-length and Section Bank schedule matching the plan, and complete guide and mastery coverage.

Files in `archive/` are superseded versions and are **not** sources.

> During the original build, three genuine weekly CARS-target mismatches were corrected at the source: Week 1 now includes the nine-passage diagnostic, and the Week 15/19 holiday passages were redistributed so the scheduled totals remain 10 and 12. The schedule design and date range were otherwise preserved.

### Placeholder exam dates

January 22–23, 2027 are **planning placeholders**, labelled as such everywhere they appear. The countdown says "Placeholder window" until you enter a real date under **Exams → Registered MCAT date**, after which it switches to "Registered MCAT" and counts to your actual date. That date syncs across your devices.

---

## Preview locally

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. The site fetches `data/site-data.json`, so opening `index.html` straight from Finder is blocked by browser security — use the local server.

For date-specific checks, add `?today=YYYY-MM-DD` before the hash, e.g. `http://localhost:8000/?today=2026-11-26#today`. This only changes the displayed "today"; it never rewrites the schedule, and the interface labels itself as previewing.

Run the test suites:

```bash
node tests/pin.test.mjs && node tests/storage.test.mjs && node tests/sync-merge.test.mjs && node tests/export.test.mjs
```

---

## How saving works

**Local first, always.** Every change is written to this browser's `localStorage` before any network request. Studying never blocks on connectivity.

**Cloud second.** Once the device is unlocked, changes sync to one private Supabase row after a short debounce, on reconnect, when the tab becomes visible, and via **Sync now**. Sync status is shown as text plus a coloured dot — never colour alone — as one of: local only, locked, pending, syncing, synced, offline, or sync paused.

**Nothing is silently discarded.** Local and cloud states are merged record by record using per-record timestamps, so the newest edit to each daily record, exam, mistake, mastery topic, draft, and setting wins. Deleting a mistake writes a timestamped tombstone that syncs too, so a stale device can never resurrect a deleted entry. If stored JSON is ever unreadable, the original text is preserved under a recovery key and offered as a download rather than being deleted.

---

## Sign-in: one PIN, with email recovery

This tracker is single-user. The gate is deliberately simple:

- **You type a numeric PIN of at least four digits.** Nothing else, on any normal day.
- **Your PIN is never stored or transmitted as typed.** It is stretched in your browser with PBKDF2-SHA256 (310,000 iterations, salted with your account email) into a long random-looking string. *That* is your Supabase account password. Supabase never stores the short PIN itself; PBKDF2 adds work to each guess, and Supabase's rate limits help protect the online sign-in endpoint.
- **Your email is typed once per device** and cached in that browser only. It is deliberately **not** committed to the repository, so a public repo never names an account for anyone to target. It also acts as a second thing an attacker would have to know.
- **The session persists.** Supabase refreshes it automatically, so in practice you type the PIN once per device and then just open the app. The PIN screen returns only on a new device, after clearing browser data, or when you tap **Lock this device**.
- **Offline never locks you out.** A device that has unlocked before stays unlocked with no connection, because a PIN cannot be verified offline. It re-locks on reconnect if the session has genuinely expired.
- **Locking is not deleting.** Locking ends cloud access on that device and leaves every local record intact.

Wrong email and wrong PIN produce the same message, so neither can be probed independently.

If you forget the PIN, **Forgot your PIN?** sends a one-use recovery link to the owner email. The
linked page asks for the new PIN twice, derives the correct account password in the browser, updates
Supabase, signs the recovery session out, and returns to a fresh unlock screen. Neither resetting nor
locking deletes local or cloud tracker data.

### One-time setup

1. **Create a Supabase project** at <https://supabase.com>.

2. **Create the database table.** Open the project's SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql). This creates a single `tracker_state` table, enables Row Level Security, revokes all access from the anonymous role, and grants each authenticated user access to their own row only.

3. **Calculate your account key.** Serve the site locally and open [`setup.html`](./setup.html). Enter the email you will use and a PIN of at least four digits. It returns a long `mm1.…` string, computed entirely in your browser — nothing is transmitted. Copy it.

4. **Turn off public sign-ups.** In **Authentication → Sign In / Providers → Email**, disable **Allow new users to sign up**. Also disable **Confirm email**, since this account is created by hand and there is no in-app confirmation flow. The site has no registration form and never calls `signUp`.

5. **Create the one owner account.** In **Authentication → Users → Add user**, enter your email and paste the `mm1.…` value as the password. Tick "Auto Confirm User". This is the only account that will ever exist.

6. **Point the site at the project.** In **Project Settings → API**, copy the **Project URL** and the **publishable** (anon) key into [`js/sync-config.js`](./js/sync-config.js).

7. **Allow the recovery pages.** In **Authentication → URL Configuration**, set the deployed site as the Site URL and add both the deployed `reset.html` address and the local preview address to **Redirect URLs**.

8. **Unlock.** Open the site, enter your email and PIN once, and it syncs.

### Signing in on a second device

Open the same URL, enter the same email and PIN. Existing local progress on that device is **merged** with the cloud copy, never overwritten. After that first unlock the email is remembered and only the PIN is asked for.

### If you forget the PIN

Tap **Forgot your PIN?** on the lock screen. Enter the owner email if this is a new device, then open
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

The publishable key is designed for browser code *provided Row Level Security is enabled* — which `schema.sql` does, and which step 2 above should be confirmed in the dashboard under **Database → Tables → tracker_state → RLS enabled**.

### Diagnosing paused sync

If the status reads **Sync paused**, open the sync panel for the reason. Local progress is never at risk while sync is paused — it keeps saving in the browser and uploads when the problem clears. Common causes: no network, an expired session (unlock again), or `sync-config.js` pointing at the wrong project. If you want a guaranteed-safe copy before troubleshooting, take a JSON backup first; it works offline and with sync disabled.

---

## Exports and backups

Everything is under **Log → Export**. All three work offline and none of them change your data.

**Excel workbook** — seven sheets (Daily Schedule, 22-Week Progress, Mistake Log, Weekly Pattern Review, High-Yield Mastery, Full-Length Scores, Lists), with frozen headers, autofilters, real date cells, wrapped long text, and no formulas to break. Generated locally with a vendored copy of ExcelJS.

**Mistake log CSV** — every field with stable headers, fully quoted, UTF-8 with BOM so Excel opens accents correctly. Commas, quotes, and newlines inside notes are escaped properly.

**JSON backup** — the complete, versioned round-trip format: all progress, exam records, mastery ratings, settings, registered exam date, unfinished form drafts, focus sessions, and deletion markers.

**Restoring** — choose a JSON file, and it is validated *before* anything changes. You pick **replace** or **merge**, you are offered a safety backup of your current state first, and you must confirm. An invalid or non-matching file is rejected with nothing altered.

XLSX and CSV are **portable reports, not sync formats**. There is no XLSX re-import; JSON is the supported full round trip. The website is the primary tracking source — there is no continuous in-place Excel sync.

---

## Deployment

The site is static and uses only relative paths, with `.nojekyll` included, so it works from a GitHub Pages project subpath.

**A private repository does not make a GitHub Pages site private.** On ordinary GitHub plans, publishing Pages from a private repo still serves the site publicly; access-controlled Pages requires GitHub Enterprise Cloud. This project is deployed on that understanding: the static interface and the generated study-plan JSON are public, while all personal progress lives behind PIN authentication and Row Level Security. If the study plan itself ever needs to be private, move to an access-controlled host rather than relying on repository visibility.

Only the `mcat-tracker/` directory is intended for deployment. The parent workspace holds the source `.docx` and `.xlsx` documents and is not part of the published site.

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
js/sync.js            Supabase auth + debounced cloud sync
js/sync-config.js     project URL + publishable key (safe to publish)
js/pin.js             shared PIN → account-key derivation
js/reset.js           recovery-session handling and PIN update
js/router.js          hash routing
js/export.js          XLSX / CSV / JSON generation
js/views/             today, plan, exams, log, guide, shared
data/site-data.json   generated deployment artifact
scripts/              site-data generator
supabase/schema.sql   table + RLS policies
tests/                storage, merge, and export test suites
vendor/               ExcelJS 4.4.0, Supabase JS 2.111.0 (MIT, vendored)
```

No third-party code is loaded from a CDN at runtime.

---

## Known limitations

- One authenticated cloud document rather than a relational backend. Fine for one user; it is not built for concurrent editing of the same record on two devices in the same second.
- Unfinished form **drafts** merge by whole-state recency rather than per-field, so a draft edited on two devices while both were offline keeps one side's version.
- No XLSX re-import. JSON is the dependable full-state import format.
- Workload estimates are labelled inferences from assignment type, mode, and targets — not measurements.
- Readiness output applies the plan's own rule and is presented as guidance, not a verdict.
- The focus timer is deliberately minimal: one optional 25-minute block with locally stored history.
- A four-digit PIN favors convenience over security. Client-side stretching protects the stored credential and Supabase rate-limits online attempts, but a longer PIN is safer and should be used if the site ever becomes multi-user or protects more sensitive data.

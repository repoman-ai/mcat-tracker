# HANDOFF — current verified state

This file is a convenience snapshot, not a source of truth. Always inspect the working tree, Git
index, live application, and Supabase project before continuing.

## Project

`/Users/macbookpro/Documents/Claude/MCAT/mcat-tracker` is a static, no-build, local-first MCAT study
tracker. Browser state saves immediately to `localStorage`; an authenticated session merges it with
one owner-only row in Supabase.

Authentication uses an owner email plus a numeric PIN of at least four digits. `js/pin.js` derives a
Supabase password with PBKDF2-SHA256 (310,000 iterations and an email-based salt). The literal PIN and
derived `mm1.…` password must never be logged, committed, or requested.

## PIN recovery is complete

- The lock screen includes **Forgot your PIN?**.
- `reset.html` and `js/reset.js` consume the Supabase recovery session, ask for the new PIN twice,
  derive the replacement password locally, update the owner account, sign out, and return to a fresh
  unlock screen.
- Expired or already-used links show a resend form.
- A real built-in-Supabase recovery email was received and the PIN change succeeded.
- Local state and the cloud row are not deleted by locking or resetting.
- PIN derivation accepts digits only and requires at least four digits.

## Supabase state verified on August 17, 2026

- Project ref: `hqsfeunkuvzuhbivlyla`
- Project URL and browser-safe anon key are present in `js/sync-config.js`.
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

Supabase's built-in sender is adequate for occasional recovery when the owner email is a project-team
address, but it is best-effort and currently limited to two messages per hour. Custom SMTP is optional
for this one-user system and is useful only if dependable production delivery is important.

## Git state

The repository is committed on `main` and tracks `origin/main` at the public repository:
`https://github.com/repoman-ai/mcat-tracker`.

GitHub Pages is enabled from the root of `main` with HTTPS enforced:
`https://repoman-ai.github.io/mcat-tracker/`.

The first Pages deployment completed successfully. The live desktop lock screen, 390×844 phone lock
screen, and live expired-link recovery page were verified with no browser warnings or errors and no
horizontal overflow. Authenticated live sign-in and sync still require the owner to type the account
email and PIN directly; never request or retrieve those credentials.

## Verification commands

```bash
node --check js/app.js
node --check js/auth-storage.js
node --check js/pin.js
node --check js/reset.js
node --check js/sync.js
node tests/pin.test.mjs
node tests/storage.test.mjs
node tests/sync-merge.test.mjs
node tests/export.test.mjs
```

The local preview uses `http://localhost:8912/index.html`. If the server process is stale, restart it
from this directory without changing the port so the existing browser origin and local data remain
the same.

## Safety boundaries

- Never request or use a service-role key, secret key, database password, account key, or PIN.
- The project URL and anon key in `js/sync-config.js` are intentionally browser-visible; RLS is the
  authorization boundary.
- Do not hand-edit `data/site-data.json`; regenerate it with `scripts/generate_site_data.py` after
  authoritative source changes.
- Only `mcat-tracker/` is intended for deployment. Do not include parent-workspace source documents.

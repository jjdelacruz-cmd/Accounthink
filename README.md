# Accounthink

Mobile-first quiz and exam platform for OLFU College of Business and Accountancy classes.
Next.js 16 (App Router) + TypeScript + Tailwind, Supabase (Postgres + Auth + RLS), deployed on Netlify.
Installable as an app (PWA) on Android and iPhone.

## Status

- [x] **Phase 1** — Setup, email/password auth, roles (student / instructor / admin), courses, sections, join codes
- [x] **Phase 2** — Item bank (MC / identification / enumeration), answer keys, exam builder
- [x] **Phase 3** — Student exam flow: start, one question per screen, autosave, server timer, server-side grading
- [x] **Phases 4–6** — Randomization, anti-cheating (sessions, device check, leave-app log, watermark,
  copy/paste block, rotating access code, leave limit), live monitor with +time / end controls
- [x] **Phase 7** — Results: score table, class stats and distribution, per-student review, item analysis (% correct, discrimination, choice counts, common wrong answers), accept-answer and re-grade, passing mark, Excel export
- [x] **Phase 8** — Bulk import: paste from Word (with ANSWER: lines or an ANSWER KEY list) or upload Excel/CSV, preview with problems and duplicates, all-or-nothing save
- [x] **Phase 9** — Installable app (manifest, icons, install prompt), offline page, loading/error screens
- [x] **Uploads** — each import is a named upload; filter the bank and the exam picker by upload; delete single, selected, or a whole upload (questions in published exams are kept)
- [x] **Student feedback** — after submitting, students see each question marked right / wrong (and, if allowed, the correct answers), with a "Mistakes only" view; the instructor picks what they see and whether it shows right away or only after the exam closes
- [x] **Essays + checking by hand** — essay questions (TYPE: Essay in imports) wait for the instructor; on *Check answers* the instructor scores essays and can override any identification / enumeration answer, with a comment for the student. Hand scores survive re-grading
- [x] **Camera monitoring** (optional per exam) — the phone's front camera checks for a face, looking away, or a second face, warns the student on screen and logs warnings for the live monitor. Runs fully on the phone (MediaPipe face model, self-hosted); no picture is stored or sent
- [x] **Checker accounts** — a separate role (set by the admin) that scores only the essay / identification / enumeration answers of exams an instructor assigns to it, and only after students have taken them. No item bank, results, other exams or messages
- [x] **Student photo** — students add a photo under Account (cropped and shrunk on their phone, stored as a small JPEG); instructors see it on the Students tab and reviews
- [x] **Messages** — a student and the instructors of their classes can message each other; student-to-student is impossible (enforced in the database). Unread badge in the header
- [x] **Announcements and email** — instructors post announcements per course or section (optionally emailed); students get an email when an exam is published and 24 hours before it opens; students can turn emails off under Account
- [x] **Password reset without email** — instructors reset students in their sections, admins anyone but admins; everyone can change their own password under Account

## Setup

1. **Supabase project** → SQL Editor → run each file in `supabase/migrations/` in order
   (`0001_…` through `0011_…`). Each is safe to re-run.
   Then run the matching `supabase/tests/phaseN_smoke_test.sql`; every row should say PASS.
2. **Env vars**: copy `.env.local.example` to `.env.local` and fill in the project URL and
   publishable key (Supabase → Project Settings → API Keys).
3. **Email confirmation link** (Supabase → Authentication → Email Templates → *Confirm signup*):
   set the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   and set **Site URL** (Authentication → URL Configuration) to your app URL
   (`http://localhost:3000` while developing).
4. `npm install && npm run dev`

### Email setup (optional)

Accounthink sends email through any SMTP account. Nothing breaks without it: students still see announcements and exams in the app.
Set these in Netlify → Site configuration → Environment variables, then redeploy:

| Variable | Example |
| --- | --- |
| `SMTP_HOST` | `smtp.gmail.com` (Gmail) or `smtp-relay.brevo.com` (Brevo) |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your Gmail address / your Brevo SMTP login |
| `SMTP_PASS` | a Gmail **app password** (Google Account → Security → 2-Step Verification → App passwords) / your Brevo SMTP key |
| `MAIL_FROM` | `Accounthink <you@gmail.com>` (must be an address you are allowed to send from) |
| `SITE_URL` | `https://accounthinkolfu.netlify.app` (used for the button in emails) |

Both Gmail (about 500 emails a day) and Brevo (300 a day) are free. Open **Manage users** as admin to see the status and send yourself a test email.

**24-hour reminders** run from a scheduled Netlify function (`netlify/functions/reminders.mjs`, hourly) that calls `/api/cron/reminders`.
Pick a secret of at least 12 characters, add it to Netlify as `CRON_SECRET`, and store the same value in the database (Supabase SQL Editor):

```sql
insert into public.app_settings (key, value) values ('cron_secret', 'YOUR-SECRET-HERE')
on conflict (key) do update set value = excluded.value;
```

### Making the first admin

Everyone signs up as a **student** — the role is never taken from the sign-up form.
After signing up yourself, run this once in the SQL Editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

From then on, promote instructors from **Manage users** (the `/admin` page).

## Testing

- **Database:** each `supabase/tests/*_smoke_test.sql` prints PASS/FAIL rows and cleans up after itself.
- **End to end:** `scripts/e2e.mjs` drives the whole app (instructor + 3 students, phone-sized Chromium)
  against a local Supabase (`npx supabase start` with these migrations) and a production build:
  ```
  BASE=http://localhost:3000 DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  PLAYWRIGHT_PATH=/path/to/playwright/index.mjs node scripts/e2e.mjs
  ```

## How roles work

| Role | Home | Can do |
| --- | --- | --- |
| Student | `/student` | Join a section with a code; take assigned exams once, with autosave and a server-side timer; see score if allowed |
| Instructor | `/instructor` | Courses, sections, students (reset passwords); item bank + bulk import; build, publish, monitor exams; results and item analysis |
| Admin | `/instructor` + `/admin` | Everything an instructor can, plus Manage users (roles, password resets) |

Security lives in the database (Row Level Security), not just the UI:
- Only admins can change roles (enforced by a trigger).
- Instructors see only their own courses, sections, and the students enrolled in them.
- Students see only sections they joined, and can join only through `join_section()` with a valid, open code.
- Answer keys live in `item_keys`, readable only by the course's instructor. Students cannot read
  `items`, `item_keys` or `exam_items` at all; Phase 3 serves questions through server functions.
- An exam's items are locked while it is published or closed (move it back to draft to edit).
- An item used in a published or closed exam can't be deleted (results depend on it); archive it instead.
  `delete_items()` / `delete_batch()` skip such items and report how many were kept.
- Students never write attempts or responses directly. `start_attempt`, `attempt_question`,
  `save_response` and `submit_attempt` check ownership, the exam window and the deadline;
  questions are served one at a time without keys, and grading runs only on the server.
- Students get their own answers back only through `my_exam_feedback()`, and only after submitting.
  Correct answers are included only if the exam's feedback setting allows it and it has been released.
- Once any student starts an exam, its items can never change and it can't go back to draft.
- Every student call carries a session token from `claim_attempt()`; opening the exam in another
  tab or device takes over the session and is logged. Students can't read `integrity_events`
  or the exam's `access_secret`.

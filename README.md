# OLFU CBA Online Exams

Mobile-first quiz and exam platform for OLFU College of Business and Accountancy classes.
Next.js (App Router) + TypeScript + Tailwind, Supabase (Postgres + Auth + RLS), deployed on Netlify.

## Status

- [x] **Phase 1** — Setup, email/password auth, roles (student / instructor / admin), courses, sections, join codes
- [ ] Phase 2 — Item bank and exam builder
- [ ] Phase 3 — Student exam flow
- [ ] Phase 4 — Randomization
- [ ] Phase 5 — Anti-cheating layers
- [ ] Phase 6 — Live monitor
- [ ] Phase 7 — Results and item analysis
- [ ] Phase 8 — Bulk import
- [ ] Phase 9 — PWA polish and deploy

## Setup

1. **Supabase project** → SQL Editor → run `supabase/migrations/0001_phase1_auth_courses_sections.sql`.
2. **Env vars**: copy `.env.local.example` to `.env.local` and fill in the project URL and
   publishable key (Supabase → Project Settings → API Keys).
3. **Email confirmation link** (Supabase → Authentication → Email Templates → *Confirm signup*):
   set the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   and set **Site URL** (Authentication → URL Configuration) to your app URL
   (`http://localhost:3000` while developing).
4. `npm install && npm run dev`

### Making the first admin

Everyone signs up as a **student** — the role is never taken from the sign-up form.
After signing up yourself, run this once in the SQL Editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

From then on, promote instructors from the **/admin** page.

## How roles work

| Role | Home | Can do (Phase 1) |
| --- | --- | --- |
| Student | `/student` | Join a section with a 6-character code, see their classes |
| Instructor | `/instructor` | Create courses and sections, see join codes and student counts, open/close joining |
| Admin | `/admin` | See all users, change roles |

Security lives in the database (Row Level Security), not just the UI:
- Only admins can change roles (enforced by a trigger).
- Instructors see only their own courses, sections, and the students enrolled in them.
- Students see only sections they joined, and can join only through `join_section()` with a valid, open code.

# Payper Trails — setup guide

A free fleet tracker: licence renewals, services, and warranties for cars, bakkies, boats, trailers and caravans — with automated email reminders.

Three free accounts needed: **Supabase** (login + database), **Resend** (sending emails), **Cloudflare** (hosting the site + running the daily reminder check).

---

## 1. Supabase (login + database)

1. Go to [supabase.com](https://supabase.com) → sign up free → **New project**.
2. Name it `payper-trails`, set a database password (save it somewhere), pick a region close to South Africa.
3. **SQL Editor → New query** → paste in the whole of `schema.sql` from this folder → **Run**.
4. **Project Settings → API** — copy:
   - **Project URL**
   - **anon / public key**
   - **service_role key** (secret — never put this in the website files, only in the Worker's secrets, step 4 below)
5. Paste the Project URL and anon key into `config.js` in this folder.
6. **Authentication → Providers → Email** — turn "Confirm email" OFF for the simplest signup flow to start (can switch on later).

## 2. Resend (sending reminder emails)

1. [resend.com](https://resend.com) → sign up free (100 emails/day, 3,000/month free).
2. **API Keys** → create one, copy it.
3. To send from your own address (e.g. `reminders@oddventures.co.za`), verify that domain under **Domains**. Until then, Resend's `onboarding@resend.dev` works for testing.

## 3. Cloudflare Pages (hosting the website)

1. Push this whole `payper-trails` folder to a GitHub repo (the `reminder-worker` subfolder comes along but Pages will ignore it — it's deployed separately in step 4).
2. In Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Build settings: no build command needed (it's plain HTML/CSS/JS) — leave build command blank, output directory `/`.
4. Deploy. You'll get a free `payper-trails.pages.dev` address instantly. Add a custom domain later, anytime, once you're ready to spend on one.

## 4. Cloudflare Worker (the daily reminder job)

This is a separate small piece from the website — Pages can't run scheduled jobs, so the reminder check runs as its own Worker.

1. On your computer (or ask me to walk you through it), install Wrangler: `npm install -g wrangler`
2. `cd reminder-worker`
3. `wrangler login` (opens a browser to connect your Cloudflare account)
4. Set the secrets (run each, paste the value when prompted):
   ```
   wrangler secret put SUPABASE_URL
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY
   wrangler secret put RESEND_API_KEY
   wrangler secret put REMINDER_FROM_EMAIL
   ```
5. Deploy: `wrangler deploy`
6. Runs automatically every day at 06:00 UTC. To test immediately, visit the URL Wrangler gives you + `/run` (e.g. `https://payper-trails-reminders.yoursubdomain.workers.dev/run`).
7. Check logs anytime with `wrangler tail`, or in the Cloudflare dashboard under **Workers & Pages → payper-trails-reminders → Logs**.

---

## What's built in

- Sign up / log in per user
- Add any number of vehicles: car, bakkie, boat, trailer, caravan, other
- Track licence renewal date, service due (by date and/or km), current odometer
- Multiple warranties/guarantees per vehicle (full vehicle warranty, tyres, battery, any new part), each with its own expiry
- Dashboard shows each vehicle as a "disc" card — colour-coded green/amber/red like a real licence disc
- Automatic email reminders at 30, 14, 7 days before, and on the day, for licences, services and warranties — sent once each, no spam

## Why split across Pages + a Worker

Cloudflare Pages Functions don't support cron/scheduled triggers — that's a Workers-only feature. So the static site lives on Pages (free, unlimited bandwidth), and the once-a-day reminder check lives in its own tiny Worker (free tier: 100,000 requests/day — we use 1). Both sit under the same free Cloudflare account, isolated from whataretheodds.co.za's usage.

## Future upsell path (mine contractors / bigger fleets)

The schema already supports this — add a `team_id`/`company_id` layer so one paying account can see everyone's fleet in one dashboard, with admins seeing all vehicles and drivers seeing their own. Worth building as v2 once individual users validate the free version.

## Known limitations to fix before a public launch

- Password reset flow isn't wired up yet (Supabase supports it — needs a "forgot password" link + reset page)
- No offline/PWA support yet — needs a data connection to load
- Email confirmation is off by default for smoother signup — turn on if spam signups become an issue

# PixelOrCode Ops

Internal CRM and outreach workspace for PixelOrCode lead management.

## Stack

- Vite
- React
- Supabase Auth, Postgres, and Storage
- Inngest durable background email campaigns
- Vercel deployment

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Required environment variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_AUTH_REDIRECT_URL=
```

Server-side Vercel functions require:

```bash
SUPABASE_SERVICE_ROLE_KEY=
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
EMAIL_TOKEN_ENCRYPTION_KEY=
OAUTH_STATE_SECRET=
APP_ORIGIN=
HOSTINGER_FROM_NAME=Riaan IT Consultants
```

Do not commit `.env.local` or any service role key.

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run db:seed
```

## Deployment

The production app is deployed on Vercel:

https://pixelorcode-ops.vercel.app

Apply `supabase/schema.sql`, install the Inngest Vercel integration, and set the
public and server-side variables shown in `.env.example`. Never expose the
service-role key, Google client secret, token-encryption key, or OAuth state
secret with a `VITE_` prefix.

In Google Cloud, add this authorized redirect URI:

```text
https://pixelorcode-ops.vercel.app/api/google-oauth
```

Bulk Fire creates durable campaigns. Once queued, email delivery continues on
Vercel through Inngest even if the browser or laptop is closed.

Bulk Fire supports both immediate background campaigns and one-off scheduled
campaigns. Scheduled times are entered in India Standard Time and, on Inngest's
free plan, must be within the next seven days.

Day 3 follows up on Day 0 in the same email thread. Day 7 replies to Day 3 when
available and otherwise falls back to Day 0. This works for both Hostinger SMTP
and connected Gmail senders when the sender and recipient addresses match.

## Background email setup

1. Apply the Supabase migrations in order, including
   `202607130001_email_threading.sql` for Day 3/Day 7 reply threading.
2. Create a Google OAuth 2.0 Web application and add the production callback
   shown above. Configure the OAuth consent screen with `gmail.send`, `openid`,
   `email`, and `profile`.
3. Add all server-side variables from `.env.example` to Vercel Production.
4. Install the Inngest Vercel integration for this project so deployments sync
   `/api/inngest` and the signing/event keys are injected.
5. Redeploy, connect Gmail from Bulk Fire, then start with a one-recipient test
   campaign before using a full playbook.

Start and completion notifications are delivered to
`vanshkalra1379@gmail.com` through the configured Hostinger SMTP mailbox. Set
`CAMPAIGN_NOTIFICATION_EMAIL` to override this destination.

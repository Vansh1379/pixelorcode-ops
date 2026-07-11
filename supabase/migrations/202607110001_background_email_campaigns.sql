create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gmail')),
  email_address text not null,
  display_name text,
  encrypted_refresh_token text not null,
  scopes text,
  status text not null default 'connected' check (status in ('connected', 'expired', 'revoked')),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, email_address)
);

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sequence_step text not null check (sequence_step in ('day0', 'day3', 'day7')),
  provider text not null check (provider in ('gmail', 'smtp')),
  connection_id uuid references public.email_connections(id) on delete restrict,
  sender_email text not null,
  notification_email text,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled')),
  total_count integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  lead_id text references public.leads(id) on delete set null,
  recipient_email text not null,
  lead_name text,
  resolved_subject text not null,
  resolved_body text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  attempt_count integer not null default 0,
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create index if not exists email_connections_user_idx on public.email_connections(user_id);
create index if not exists email_campaigns_user_created_idx on public.email_campaigns(user_id, created_at desc);
create index if not exists email_campaign_recipients_campaign_idx on public.email_campaign_recipients(campaign_id);

alter table public.email_connections enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;

-- Connections contain encrypted credentials and are intentionally only read by
-- service-role Vercel functions.  No direct client policy is created.
create policy "Users can read their email campaigns"
on public.email_campaigns for select to authenticated
using (auth.uid() = user_id);

create policy "Users can read their campaign recipients"
on public.email_campaign_recipients for select to authenticated
using (exists (
  select 1 from public.email_campaigns c
  where c.id = campaign_id and c.user_id = auth.uid()
));

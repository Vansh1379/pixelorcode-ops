create extension if not exists pgcrypto;

create table if not exists public.leads (
  id text primary key,
  source_id text,
  name text not null,
  list text,
  niche text,
  location text,
  address text,
  phone text,
  alternate_phone text,
  email text,
  website_status text,
  rating text,
  reviews text,
  source_link text,
  other_link text,
  lead_reason text,
  pitch text,
  decision_maker text,
  opening_hours text,
  notes text,
  status text not null default 'Not Contacted',
  owner text not null default 'Unassigned',
  last_action text,
  whatsapp_sent boolean not null default false,
  whatsapp_replied boolean not null default false,
  email_sent boolean not null default false,
  next_follow_up date,
  proposal_status text not null default 'None',
  client_value text,
  email_replied boolean not null default false,
  created_at date default current_date,
  updated_at date default current_date
);

create table if not exists public.proposals (
  id text primary key,
  lead_name text,
  client text not null,
  status text not null default 'Sent',
  value text,
  phone text,
  email text,
  owner text not null default 'Sales Team',
  service text,
  sent_date date,
  valid_until date,
  next_step text,
  file_name text,
  file_type text default 'application/pdf',
  file_path text,
  notes text,
  created_at date default current_date,
  updated_at date default current_date
);

-- Durable email connections and campaigns.  Gmail refresh tokens are encrypted
-- by the Vercel API before they ever reach this database.
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
  sequence_group_id uuid,
  auto_follow_ups boolean not null default false,
  sequence_anchor_at timestamptz,
  parent_campaign_id uuid references public.email_campaigns(id) on delete set null,
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
  provider_thread_id text,
  rfc_message_id text,
  error_message text,
  replied_at timestamptz,
  sequence_messages jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_list_idx on public.leads(list);
create index if not exists leads_owner_idx on public.leads(owner);
create index if not exists proposals_client_idx on public.proposals(client);
create index if not exists email_connections_user_idx on public.email_connections(user_id);
create index if not exists email_campaigns_user_created_idx on public.email_campaigns(user_id, created_at desc);
create index if not exists email_campaign_recipients_campaign_idx on public.email_campaign_recipients(campaign_id);
create index if not exists email_campaigns_sequence_group_idx on public.email_campaigns(sequence_group_id);
create index if not exists email_campaign_recipients_reply_lookup_idx on public.email_campaign_recipients(recipient_email, replied_at);

insert into storage.buckets (id, name, public)
values ('proposal-pdfs', 'proposal-pdfs', false)
on conflict (id) do nothing;

alter table public.leads enable row level security;
alter table public.proposals enable row level security;
alter table public.email_connections enable row level security;
alter table public.email_campaigns enable row level security;
alter table public.email_campaign_recipients enable row level security;

-- Prototype policy: authenticated users can manage CRM data.
-- Add team-specific roles later if PixelOrCode needs granular permissions.
create policy "Authenticated users can read leads"
on public.leads for select
to authenticated
using (true);

create policy "Authenticated users can write leads"
on public.leads for all
to authenticated
using (true)
with check (true);

create policy "Authenticated users can read proposals"
on public.proposals for select
to authenticated
using (true);

create policy "Authenticated users can write proposals"
on public.proposals for all
to authenticated
using (true)
with check (true);

create policy "Users can read their email campaigns"
on public.email_campaigns for select to authenticated
using (auth.uid() = user_id);

create policy "Users can read their campaign recipients"
on public.email_campaign_recipients for select to authenticated
using (exists (
  select 1 from public.email_campaigns c
  where c.id = campaign_id and c.user_id = auth.uid()
));

create policy "Authenticated users can read proposal PDFs"
on storage.objects for select
to authenticated
using (bucket_id = 'proposal-pdfs');

create policy "Authenticated users can upload proposal PDFs"
on storage.objects for insert
to authenticated
with check (bucket_id = 'proposal-pdfs');

create policy "Authenticated users can update proposal PDFs"
on storage.objects for update
to authenticated
using (bucket_id = 'proposal-pdfs')
with check (bucket_id = 'proposal-pdfs');

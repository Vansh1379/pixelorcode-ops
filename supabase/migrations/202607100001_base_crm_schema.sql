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

create index if not exists leads_status_idx on public.leads(status);
create index if not exists leads_list_idx on public.leads(list);
create index if not exists leads_owner_idx on public.leads(owner);
create index if not exists proposals_client_idx on public.proposals(client);

insert into storage.buckets (id, name, public)
values ('proposal-pdfs', 'proposal-pdfs', false)
on conflict (id) do nothing;

alter table public.leads enable row level security;
alter table public.proposals enable row level security;

create policy "Authenticated users can read leads"
on public.leads for select to authenticated using (true);

create policy "Authenticated users can write leads"
on public.leads for all to authenticated using (true) with check (true);

create policy "Authenticated users can read proposals"
on public.proposals for select to authenticated using (true);

create policy "Authenticated users can write proposals"
on public.proposals for all to authenticated using (true) with check (true);

create policy "Authenticated users can read proposal PDFs"
on storage.objects for select to authenticated
using (bucket_id = 'proposal-pdfs');

create policy "Authenticated users can upload proposal PDFs"
on storage.objects for insert to authenticated
with check (bucket_id = 'proposal-pdfs');

create policy "Authenticated users can update proposal PDFs"
on storage.objects for update to authenticated
using (bucket_id = 'proposal-pdfs')
with check (bucket_id = 'proposal-pdfs');

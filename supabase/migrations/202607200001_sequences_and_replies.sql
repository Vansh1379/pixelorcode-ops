-- Auto follow-up sequences + reply detection.
--
-- A "sequence" is one Day 0 campaign that automatically spawns Day 3 (+3 days)
-- and Day 7 (+7 days) campaigns. All three share a sequence_group_id. If a lead
-- replies to any email in the sequence, its remaining follow-ups are suppressed
-- (replied_at is set on every recipient row for that lead in the group).

alter table public.email_campaigns
  add column if not exists sequence_group_id uuid,
  add column if not exists auto_follow_ups boolean not null default false,
  add column if not exists sequence_anchor_at timestamptz,
  add column if not exists parent_campaign_id uuid references public.email_campaigns(id) on delete set null;

alter table public.email_campaign_recipients
  add column if not exists replied_at timestamptz,
  add column if not exists sequence_messages jsonb;

alter table public.leads
  add column if not exists email_replied boolean not null default false;

create index if not exists email_campaigns_sequence_group_idx
  on public.email_campaigns(sequence_group_id);

create index if not exists email_campaign_recipients_reply_lookup_idx
  on public.email_campaign_recipients(recipient_email, replied_at);

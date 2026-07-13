alter table public.email_campaign_recipients
  add column if not exists provider_thread_id text,
  add column if not exists rfc_message_id text;

create index if not exists email_campaign_recipients_thread_lookup_idx
  on public.email_campaign_recipients(recipient_email, status, sent_at desc);

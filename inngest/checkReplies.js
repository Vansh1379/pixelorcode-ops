import { inngest } from "./client.js";
import { getSupabaseAdmin } from "../server/supabaseAdmin.js";
import { fetchInboxReplies } from "../server/imapReplies.js";
import { sendCampaignNotification } from "../server/mailer.js";
import { getCampaignNotificationEmail } from "../server/campaignNotification.js";

const LOOKBACK_DAYS = 14;

// Hourly: scan the SMTP mailbox for replies from leads we have emailed, mark
// those leads as replied (suppressing every remaining follow-up in the sequence),
// and notify the operator. Reply detection is SMTP-only.
export const checkReplies = inngest.createFunction(
  { id: "check-email-replies", triggers: [{ cron: "0 * * * *" }] },
  async ({ step }) => {
    return step.run("scan-replies", async () => {
      const admin = getSupabaseAdmin();
      const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

      // 1. Recent SMTP campaigns (the only path we can read replies for).
      const { data: campaigns, error: campaignError } = await admin.from("email_campaigns")
        .select("id, name, sender_email, sequence_step, sequence_group_id, provider")
        .eq("provider", "smtp")
        .gte("created_at", sinceIso);
      if (campaignError) throw campaignError;
      if (!campaigns || campaigns.length === 0) return { scanned: 0, replies: 0 };
      const campaignById = new Map(campaigns.map((c) => [c.id, c]));

      // 2. Their sent, not-yet-replied recipients.
      const { data: recipients, error: recipientError } = await admin.from("email_campaign_recipients")
        .select("id, campaign_id, lead_id, recipient_email, lead_name, rfc_message_id, sent_at")
        .in("campaign_id", campaigns.map((c) => c.id))
        .eq("status", "sent")
        .is("replied_at", null)
        .gte("sent_at", sinceIso);
      if (recipientError) throw recipientError;
      if (!recipients || recipients.length === 0) return { scanned: 0, replies: 0 };

      // 3. Read the inbox once, from just before the earliest send.
      const earliest = recipients.reduce((min, r) => {
        const t = Date.parse(r.sent_at);
        return Number.isFinite(t) && t < min ? t : min;
      }, Date.now());
      const inbox = await fetchInboxReplies(new Date(earliest - 60 * 60 * 1000));
      if (inbox.length === 0) return { scanned: recipients.length, replies: 0 };

      const nowIso = new Date().toISOString();
      const processedKeys = new Set();
      let replies = 0;

      for (const recipient of recipients) {
        const campaign = campaignById.get(recipient.campaign_id) || {};
        // Group replies by lead so one lead is only processed/notified once per run.
        const key = campaign.sequence_group_id
          ? `${campaign.sequence_group_id}:${recipient.recipient_email}`
          : `${recipient.campaign_id}:${recipient.recipient_email}`;
        if (processedKeys.has(key)) continue;

        const sentMs = Date.parse(recipient.sent_at) || 0;
        const rfc = (recipient.rfc_message_id || "").trim();
        const match = inbox.find((msg) => {
          const after = (Date.parse(msg.date) || 0) >= sentMs;
          if (!after) return false;
          if (msg.from && msg.from === recipient.recipient_email) return true;
          if (rfc && (msg.inReplyTo.includes(rfc) || msg.references.includes(rfc))) return true;
          return false;
        });
        if (!match) continue;

        processedKeys.add(key);
        replies++;

        // Cascade: stamp replied_at on every recipient row for this lead in the
        // sequence (so Day 3 / Day 7 skip it); one-offs just mark this row.
        const cascade = admin.from("email_campaign_recipients").update({ replied_at: nowIso, updated_at: nowIso })
          .eq("recipient_email", recipient.recipient_email)
          .is("replied_at", null);
        if (campaign.sequence_group_id) {
          const groupCampaignIds = campaigns.filter((c) => c.sequence_group_id === campaign.sequence_group_id).map((c) => c.id);
          await cascade.in("campaign_id", groupCampaignIds);
        } else {
          await cascade.eq("campaign_id", recipient.campaign_id);
        }

        if (recipient.lead_id) {
          await admin.from("leads").update({
            email_replied: true,
            status: "Replied",
            last_action: `Replied to ${campaign.sequence_step?.toUpperCase() || "email"} · ${nowIso.slice(0, 10)}`,
            updated_at: nowIso.slice(0, 10),
          }).eq("id", recipient.lead_id);
        }

        await sendCampaignNotification({
          to: getCampaignNotificationEmail(),
          subject: `Reply received — ${recipient.lead_name || recipient.recipient_email}`,
          body: [
            `A lead replied — their remaining follow-ups have been stopped.`,
            ``,
            `Lead: ${recipient.lead_name || "(unknown)"}`,
            `Email: ${recipient.recipient_email}`,
            `Campaign: ${campaign.name || "(unknown)"}`,
            `Replied to: ${campaign.sequence_step?.toUpperCase() || "email"}`,
            `Reply subject: ${match.subject || "(none)"}`,
            `Received: ${new Date(match.date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
          ].join("\n"),
        });
      }

      return { scanned: recipients.length, replies };
    });
  },
);

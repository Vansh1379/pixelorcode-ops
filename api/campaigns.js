import { randomUUID } from "node:crypto";
import { inngest } from "../inngest/client.js";
import { getSupabaseAdmin, requireApiUser } from "../server/supabaseAdmin.js";
import { normalizeScheduledAt } from "../server/campaignSchedule.js";
import { getCampaignNotificationEmail } from "../server/campaignNotification.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A resolved {subject, body} pair is valid when both are present and bounded.
function isValidMessage(msg) {
  return Boolean(
    msg &&
      typeof msg.subject === "string" &&
      typeof msg.body === "string" &&
      msg.subject.trim() &&
      msg.body.trim() &&
      msg.subject.length <= 500 &&
      msg.body.length <= 50000,
  );
}

export default async function handler(req, res) {
  try {
    const user = await requireApiUser(req);
    const admin = getSupabaseAdmin();

    if (req.method === "GET") {
      const { data, error } = await admin.from("email_campaigns")
        .select("id, name, sequence_step, provider, sender_email, status, total_count, sent_count, failed_count, skipped_count, scheduled_at, started_at, completed_at, created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return res.status(200).json({ campaigns: data || [] });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { name, sequenceStep, provider, connectionId, senderEmail, recipients, scheduledAt, autoFollowUps } = req.body || {};
    if (!["day0", "day3", "day7"].includes(sequenceStep)) return res.status(400).json({ error: "Invalid sequence step." });
    // Auto follow-up sequences always begin at Day 0; Day 3 / Day 7 are spawned
    // automatically once the previous step completes.
    if (autoFollowUps && sequenceStep !== "day0") {
      return res.status(400).json({ error: "Auto follow-up sequences must start at Day 0." });
    }
    if (!["gmail", "smtp"].includes(provider)) return res.status(400).json({ error: "Invalid sender provider." });
    if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 250) {
      return res.status(400).json({ error: "Choose between 1 and 250 recipients." });
    }
    if (!EMAIL_RE.test(senderEmail || "")) return res.status(400).json({ error: "Invalid sender email." });

    if (provider === "gmail") {
      const { data: connection } = await admin.from("email_connections").select("id, email_address, status")
        .eq("id", connectionId).eq("user_id", user.id).eq("status", "connected").maybeSingle();
      if (!connection || connection.email_address.toLowerCase() !== senderEmail.toLowerCase()) {
        return res.status(400).json({ error: "The selected Gmail connection is invalid." });
      }
    }
    if (provider === "smtp" && senderEmail.toLowerCase() !== String(process.env.HOSTINGER_SMTP_USER || "").toLowerCase()) {
      return res.status(400).json({ error: "The SMTP sender does not match the configured mailbox." });
    }

    const normalized = recipients.map((item) => {
      // For auto sequences, carry the resolved Day 0/3/7 messages so the follow-up
      // campaigns can be built later without re-resolving templates.
      let sequenceMessages = null;
      if (autoFollowUps) {
        const src = item.sequenceMessages || {};
        sequenceMessages = {
          day0: { subject: String(src.day0?.subject || item.subject || "").trim(), body: String(src.day0?.body || item.body || "").trim() },
          day3: { subject: String(src.day3?.subject || "").trim(), body: String(src.day3?.body || "").trim() },
          day7: { subject: String(src.day7?.subject || "").trim(), body: String(src.day7?.body || "").trim() },
        };
      }
      return {
        lead_id: String(item.leadId || "") || null,
        recipient_email: String(item.email || "").trim().toLowerCase(),
        lead_name: String(item.leadName || "").slice(0, 300),
        resolved_subject: String(item.subject || "").trim(),
        resolved_body: String(item.body || "").trim(),
        sequence_messages: sequenceMessages,
      };
    });
    const invalid = normalized.find((item) => !EMAIL_RE.test(item.recipient_email) || !item.resolved_subject || !item.resolved_body || item.resolved_subject.length > 500 || item.resolved_body.length > 50000);
    if (invalid) return res.status(400).json({ error: "One or more recipients or resolved messages are invalid." });
    // When auto follow-ups are on, every recipient needs valid Day 3 and Day 7 messages.
    if (autoFollowUps) {
      const badSequence = normalized.find((item) => !isValidMessage(item.sequence_messages?.day3) || !isValidMessage(item.sequence_messages?.day7));
      if (badSequence) return res.status(400).json({ error: "Auto follow-ups need a Day 3 and Day 7 template for every selected lead." });
    }

    const now = new Date().toISOString();
    const normalizedScheduledAt = normalizeScheduledAt(scheduledAt);
    const { data: campaign, error: campaignError } = await admin.from("email_campaigns").insert({
      user_id: user.id,
      name: String(name || `${sequenceStep.toUpperCase()} campaign`).slice(0, 200),
      sequence_step: sequenceStep,
      provider,
      connection_id: provider === "gmail" ? connectionId : null,
      sender_email: senderEmail,
      notification_email: getCampaignNotificationEmail(),
      status: "queued",
      total_count: normalized.length,
      scheduled_at: normalizedScheduledAt,
      auto_follow_ups: Boolean(autoFollowUps),
      sequence_group_id: autoFollowUps ? randomUUID() : null,
      sequence_anchor_at: autoFollowUps ? normalizedScheduledAt : null,
    }).select("*").single();
    if (campaignError) throw campaignError;

    const rows = normalized.map((item) => ({ ...item, campaign_id: campaign.id }));
    const { error: recipientError } = await admin.from("email_campaign_recipients").insert(rows);
    if (recipientError) {
      await admin.from("email_campaigns").delete().eq("id", campaign.id);
      throw recipientError;
    }

    try {
      await inngest.send({
        name: "pixelorcode/campaign.requested",
        data: { campaignId: campaign.id },
        ts: Date.parse(normalizedScheduledAt),
      });
    } catch (error) {
      await admin.from("email_campaigns").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", campaign.id);
      throw error;
    }
    return res.status(202).json({ campaign });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
}

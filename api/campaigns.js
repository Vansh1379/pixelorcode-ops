import { inngest } from "../inngest/client.js";
import { getSupabaseAdmin, requireApiUser } from "../server/supabaseAdmin.js";
import { normalizeScheduledAt } from "../server/campaignSchedule.js";
import { getCampaignNotificationEmail } from "../server/campaignNotification.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const { name, sequenceStep, provider, connectionId, senderEmail, recipients, scheduledAt } = req.body || {};
    if (!["day0", "day3", "day7"].includes(sequenceStep)) return res.status(400).json({ error: "Invalid sequence step." });
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

    const normalized = recipients.map((item) => ({
      lead_id: String(item.leadId || "") || null,
      recipient_email: String(item.email || "").trim().toLowerCase(),
      lead_name: String(item.leadName || "").slice(0, 300),
      resolved_subject: String(item.subject || "").trim(),
      resolved_body: String(item.body || "").trim(),
    }));
    const invalid = normalized.find((item) => !EMAIL_RE.test(item.recipient_email) || !item.resolved_subject || !item.resolved_body || item.resolved_subject.length > 500 || item.resolved_body.length > 50000);
    if (invalid) return res.status(400).json({ error: "One or more recipients or resolved messages are invalid." });

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

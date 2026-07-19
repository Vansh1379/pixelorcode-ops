import { inngest } from "./client.js";
import { getSupabaseAdmin } from "../server/supabaseAdmin.js";
import { sendGmailMail } from "../server/gmail.js";
import { sendCampaignNotification, sendSmtpMail } from "../server/mailer.js";
import { getCampaignNotificationEmail } from "../server/campaignNotification.js";
import { makeThreadedSubject, previousSequenceSteps } from "../server/emailThreading.js";

async function loadCampaign(campaignId) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("email_campaigns").select("*").eq("id", campaignId).single();
  if (error) throw error;
  return data;
}

async function refreshCounts(campaignId) {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("email_campaign_recipients")
    .select("status").eq("campaign_id", campaignId);
  if (error) throw error;
  const counts = { sent: 0, failed: 0, skipped: 0 };
  for (const row of data || []) if (counts[row.status] != null) counts[row.status]++;
  await admin.from("email_campaigns").update({
    sent_count: counts.sent,
    failed_count: counts.failed,
    skipped_count: counts.skipped,
    updated_at: new Date().toISOString(),
  }).eq("id", campaignId);
  return counts;
}

async function findPreviousMessage(campaign, recipient) {
  const steps = previousSequenceSteps(campaign.sequence_step);
  if (!steps.length) return null;
  const admin = getSupabaseAdmin();

  // Day 7 prefers Day 3, then falls back to Day 0. Day 3 only replies to Day 0.
  for (const sequenceStep of steps) {
    const { data: campaigns, error: campaignError } = await admin.from("email_campaigns")
      .select("id")
      .eq("user_id", campaign.user_id)
      .eq("provider", campaign.provider)
      .eq("sender_email", campaign.sender_email)
      .eq("sequence_step", sequenceStep)
      .order("created_at", { ascending: false })
      .limit(30);
    if (campaignError) throw campaignError;
    const campaignIds = (campaigns || []).map((item) => item.id);
    if (!campaignIds.length) continue;

    const { data: previous, error: recipientError } = await admin.from("email_campaign_recipients")
      .select("provider_message_id, provider_thread_id, rfc_message_id, resolved_subject, sent_at")
      .in("campaign_id", campaignIds)
      .eq("recipient_email", recipient.recipient_email)
      .eq("status", "sent")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recipientError) throw recipientError;
    if (previous) {
      return {
        providerMessageId: previous.provider_message_id || "",
        threadId: previous.provider_thread_id || "",
        rfcMessageId: previous.rfc_message_id || "",
        subject: previous.resolved_subject || "",
      };
    }
  }
  return null;
}

export const sendCampaign = inngest.createFunction(
  {
    id: "send-background-email-campaign",
    triggers: [{ event: "pixelorcode/campaign.requested" }],
    retries: 2,
  },
  async ({ event, step }) => {
    const campaignId = event.data.campaignId;
    const campaign = await step.run("start-campaign", async () => {
      const current = await loadCampaign(campaignId);
      if (["cancelled", "completed", "completed_with_errors"].includes(current.status)) return current;
      const startedAt = new Date().toISOString();
      const { error } = await getSupabaseAdmin().from("email_campaigns").update({
        status: "running", started_at: startedAt, updated_at: startedAt,
      }).eq("id", campaignId);
      if (error) throw error;
      await sendCampaignNotification({
        to: getCampaignNotificationEmail(),
        subject: `Campaign started — ${current.name}`,
        body: [
          `Your ${current.sequence_step.toUpperCase()} campaign has started in the background.`,
          `Campaign: ${current.name}`,
          `Sender: ${current.sender_email}`,
          `Recipients: ${current.total_count}`,
          `Started: ${new Date(startedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
        ].join("\n"),
      });
      return { ...current, status: "running", started_at: startedAt };
    });

    if (["cancelled", "completed", "completed_with_errors"].includes(campaign.status)) return campaign;

    const recipients = await step.run("load-recipients", async () => {
      const { data, error } = await getSupabaseAdmin().from("email_campaign_recipients")
        .select("*").eq("campaign_id", campaignId).order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    });

    for (let index = 0; index < recipients.length; index++) {
      const recipient = recipients[index];
      await step.run(`send-${recipient.id}`, async () => {
        const admin = getSupabaseAdmin();
        const currentCampaign = await loadCampaign(campaignId);
        if (currentCampaign.status === "cancelled") {
          await admin.from("email_campaign_recipients").update({ status: "cancelled" })
            .eq("id", recipient.id).eq("status", "pending");
          return { skipped: true };
        }

        const { data: current, error: readError } = await admin.from("email_campaign_recipients")
          .select("*").eq("id", recipient.id).single();
        if (readError) throw readError;
        if (["sent", "skipped", "cancelled"].includes(current.status)) return { skipped: true };

        await admin.from("email_campaign_recipients").update({
          status: "sending",
          attempt_count: current.attempt_count + 1,
          error_message: null,
          updated_at: new Date().toISOString(),
        }).eq("id", current.id);

        try {
          const replyTo = await findPreviousMessage(campaign, current);
          if (campaign.sequence_step !== "day0" && !replyTo) {
            throw new Error(`No earlier sent email was found for ${current.recipient_email} from ${campaign.sender_email}; follow-up was not sent as a new thread.`);
          }
          const subject = replyTo
            ? makeThreadedSubject(replyTo.subject, current.resolved_subject)
            : current.resolved_subject;
          let result;
          if (campaign.provider === "gmail") {
            const { data: connection, error } = await admin.from("email_connections")
              .select("*").eq("id", campaign.connection_id).eq("user_id", campaign.user_id).single();
            if (error || !connection || connection.status !== "connected") {
              throw new Error("The Gmail connection is unavailable or has been disconnected.");
            }
            result = await sendGmailMail({
              connection,
              to: current.recipient_email,
              subject,
              body: current.resolved_body,
              senderEmail: campaign.sender_email,
              replyTo,
            });
            await admin.from("email_connections").update({ last_used_at: new Date().toISOString() })
              .eq("id", connection.id);
          } else {
            result = await sendSmtpMail({
              to: current.recipient_email,
              subject,
              body: current.resolved_body,
              replyTo,
            });
          }

          const sentAt = new Date().toISOString();
          await admin.from("email_campaign_recipients").update({
            status: "sent", provider_message_id: result.messageId,
            provider_thread_id: result.threadId || null,
            rfc_message_id: result.rfcMessageId || null,
            sent_at: sentAt, updated_at: sentAt,
          }).eq("id", current.id);
          if (current.lead_id) {
            await admin.from("leads").update({
              email_sent: true,
              status: "Email Sent",
              last_action: `${campaign.sequence_step.toUpperCase()} sent · ${sentAt.slice(0, 10)}`,
              updated_at: sentAt.slice(0, 10),
            }).eq("id", current.lead_id);
          }
          await refreshCounts(campaignId);
          return result;
        } catch (error) {
          await admin.from("email_campaign_recipients").update({
            status: "failed", error_message: error.message.slice(0, 1000),
            updated_at: new Date().toISOString(),
          }).eq("id", current.id);
          await refreshCounts(campaignId);
          return { error: error.message };
        }
      });

      if (index < recipients.length - 1) {
        const delaySeconds = 300 + Math.floor(Math.random() * 301);
        await step.sleep(`throttle-${recipient.id}`, `${delaySeconds}s`);
      }
    }

    return step.run("complete-campaign", async () => {
      const counts = await refreshCounts(campaignId);
      const completedAt = new Date().toISOString();
      const status = counts.failed > 0 ? "completed_with_errors" : "completed";
      await getSupabaseAdmin().from("email_campaigns").update({
        status, completed_at: completedAt, updated_at: completedAt,
      }).eq("id", campaignId);
      await sendCampaignNotification({
        to: getCampaignNotificationEmail(),
        subject: `Campaign completed — ${campaign.name} — ${counts.sent} sent, ${counts.failed} failed`,
        body: [
          `Campaign: ${campaign.name}`,
          `Sender: ${campaign.sender_email}`,
          `Sent: ${counts.sent}`,
          `Failed: ${counts.failed}`,
          `Skipped: ${counts.skipped}`,
          `Completed: ${new Date(completedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
        ].join("\n"),
      });
      return { campaignId, status, ...counts };
    });
  }
);

import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { ImapFlow } from "imapflow";

let transport;

function getTransport() {
  if (transport) return transport;
  const port = Number(process.env.HOSTINGER_SMTP_PORT || 465);
  const secureSetting = process.env.HOSTINGER_SMTP_SECURE;
  transport = nodemailer.createTransport({
    host: process.env.HOSTINGER_SMTP_HOST || "smtp.hostinger.com",
    port,
    secure: secureSetting == null ? port === 465 : secureSetting.toLowerCase() === "true",
    auth: {
      user: process.env.HOSTINGER_SMTP_USER,
      pass: process.env.HOSTINGER_SMTP_PASS,
    },
  });
  return transport;
}

export async function sendSmtpMail({ to, subject, body, fromName = "" }) {
  if (!process.env.HOSTINGER_SMTP_USER || !process.env.HOSTINGER_SMTP_PASS) {
    throw new Error("Hostinger SMTP is not configured.");
  }
  const address = process.env.HOSTINGER_SMTP_USER;
  const from = fromName ? `"${fromName.replace(/[\r\n"]/g, "")}" <${address}>` : address;
  const mail = { from, to, subject, text: body };
  const info = await getTransport().sendMail(mail);
  if ((process.env.HOSTINGER_SAVE_TO_SENT || "").toLowerCase() !== "false") {
    try {
      const raw = await new MailComposer(mail).compile().build();
      const port = Number(process.env.HOSTINGER_IMAP_PORT || 993);
      const client = new ImapFlow({
        host: process.env.HOSTINGER_IMAP_HOST || "imap.hostinger.com",
        port,
        secure: port === 993,
        auth: { user: process.env.HOSTINGER_SMTP_USER, pass: process.env.HOSTINGER_SMTP_PASS },
        logger: false,
      });
      try {
        await client.connect();
        const boxes = await client.list();
        const sent = boxes.find((box) => box.specialUse === "\\Sent") || boxes.find((box) => /(^|[./])sent( items)?$/i.test(box.path));
        await client.append(sent?.path || "Sent", raw, ["\\Seen"], new Date());
      } finally {
        try { await client.logout(); } catch { /* best effort */ }
      }
    } catch (error) {
      console.error("Failed to save background email to Sent", error);
    }
  }
  return { messageId: info.messageId || "" };
}

export async function sendCampaignNotification({ to, subject, body }) {
  if (!to) return;
  try {
    await sendSmtpMail({ to, subject, body, fromName: "PixelOrCode Ops" });
  } catch (error) {
    console.error("Campaign notification failed", error);
  }
}

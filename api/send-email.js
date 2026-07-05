import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { ImapFlow } from "imapflow";

// Vercel serverless function: sends a single email through Hostinger SMTP and
// files a copy into the mailbox's Sent folder over IMAP (so it shows up in
// Hostinger webmail, like a normal client would). The browser cannot open raw
// SMTP/IMAP sockets, so it POSTs here. Credentials live only in Vercel env
// vars — never in the client bundle.
//
// Required environment variables (Vercel → Project → Settings → Env):
//   HOSTINGER_SMTP_USER  e.g. ankit@riaanitconsultants.com
//   HOSTINGER_SMTP_PASS  the mailbox password
// Optional (SMTP):
//   HOSTINGER_SMTP_HOST    default "smtp.hostinger.com"
//   HOSTINGER_SMTP_PORT    default 465 (SSL)
//   HOSTINGER_SMTP_SECURE  "true"/"false" (else inferred from port)
// Optional (IMAP, for saving to Sent — reuses the SMTP user/pass):
//   HOSTINGER_IMAP_HOST    default "imap.hostinger.com"
//   HOSTINGER_IMAP_PORT    default 993 (SSL)
//   HOSTINGER_SAVE_TO_SENT "false" to disable saving a Sent copy

let cachedTransport = null;

function getTransport() {
  if (cachedTransport) return cachedTransport;
  const host = process.env.HOSTINGER_SMTP_HOST || "smtp.hostinger.com";
  const port = Number(process.env.HOSTINGER_SMTP_PORT || 465);
  // Honor an explicit HOSTINGER_SMTP_SECURE if set; otherwise infer from the
  // port (465 = SSL/secure, 587 = STARTTLS/not secure).
  const secureEnv = process.env.HOSTINGER_SMTP_SECURE;
  const secure =
    secureEnv != null ? secureEnv.toLowerCase() === "true" : port === 465;
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.HOSTINGER_SMTP_USER,
      pass: process.env.HOSTINGER_SMTP_PASS,
    },
  });
  return cachedTransport;
}

// Build the full raw MIME message once so the exact same bytes can be both sent
// over SMTP and appended to the Sent folder over IMAP.
function buildRawMessage(mail) {
  return new Promise((resolve, reject) => {
    new MailComposer(mail).compile().build((err, message) => {
      if (err) reject(err);
      else resolve(message);
    });
  });
}

// Best-effort: append the sent message to the account's Sent mailbox via IMAP.
// Never throws — a Sent-copy failure must not fail the actual send.
async function saveToSentFolder(raw) {
  if ((process.env.HOSTINGER_SAVE_TO_SENT || "").toLowerCase() === "false") return false;

  const host = process.env.HOSTINGER_IMAP_HOST || "imap.hostinger.com";
  const port = Number(process.env.HOSTINGER_IMAP_PORT || 993);
  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: {
      user: process.env.HOSTINGER_SMTP_USER,
      pass: process.env.HOSTINGER_SMTP_PASS,
    },
    logger: false,
  });

  try {
    await client.connect();
    // Find the folder flagged as \Sent; fall back to a "Sent" named path.
    let sentPath = "Sent";
    const boxes = await client.list();
    const flagged = boxes.find((b) => b.specialUse === "\\Sent");
    const named = boxes.find((b) => /(^|[./])sent( items)?$/i.test(b.path));
    sentPath = flagged?.path || named?.path || sentPath;

    await client.append(sentPath, raw, ["\\Seen"], new Date());
    return true;
  } catch (err) {
    console.error("Failed to save copy to Sent folder", err);
    return false;
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore logout errors
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.HOSTINGER_SMTP_USER || !process.env.HOSTINGER_SMTP_PASS) {
    return res.status(500).json({
      error:
        "SMTP is not configured. Set HOSTINGER_SMTP_USER and HOSTINGER_SMTP_PASS in Vercel env vars.",
    });
  }

  try {
    const { to, subject, body, fromName, fromEmail } = req.body || {};

    if (!to || !to.includes("@")) {
      return res.status(400).json({ error: "Missing or invalid 'to' address." });
    }
    if (!subject || !body) {
      return res.status(400).json({ error: "Missing subject or body." });
    }

    // Hostinger only lets you send as the authenticated mailbox. Force the
    // From address to the SMTP user so the message isn't rejected as spoofing,
    // but keep any display name the caller asked for.
    const authUser = process.env.HOSTINGER_SMTP_USER;
    const fromAddress = fromEmail && fromEmail === authUser ? fromEmail : authUser;
    const from = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;

    // --- SEND (unchanged, proven path) --------------------------------------
    // This is exactly the call that is already working in production. Do NOT
    // couple anything to it so delivery can never be affected.
    const info = await getTransport().sendMail({
      from,
      to,
      subject,
      text: body,
    });

    // --- SAVE TO SENT (purely additive, best-effort) ------------------------
    // Runs only after the send has already succeeded, and is fully isolated in
    // its own try/catch — any failure here cannot change the send result.
    let savedToSent = false;
    try {
      const raw = await buildRawMessage({ from, to, subject, text: body });
      savedToSent = await saveToSentFolder(raw);
    } catch (copyErr) {
      console.error("Sent-copy step failed (send already succeeded)", copyErr);
    }

    return res.status(200).json({ ok: true, messageId: info.messageId, savedToSent });
  } catch (err) {
    console.error("SMTP send failed", err);
    return res.status(502).json({ error: `SMTP send failed: ${err.message}` });
  }
}

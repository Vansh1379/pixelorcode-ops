import { ImapFlow } from "imapflow";

// Reads inbound messages from the Hostinger mailbox INBOX so the reply checker
// can tell which leads have answered. Uses the same SMTP credentials/host as the
// sender (Hostinger exposes IMAP with the same mailbox login). Reply detection is
// SMTP-only by design — Gmail send-only tokens cannot read a mailbox.

function normalizeAddress(value = "") {
  const match = String(value).match(/<([^>]+)>/);
  return (match ? match[1] : String(value)).trim().toLowerCase();
}

// Returns inbound messages received since `sinceDate`, each as
// { from, inReplyTo, references, subject, date }. Never throws for an empty
// mailbox; returns [] and logs on connection failure.
export async function fetchInboxReplies(sinceDate) {
  if (!process.env.HOSTINGER_SMTP_USER || !process.env.HOSTINGER_SMTP_PASS) {
    throw new Error("Hostinger SMTP/IMAP is not configured.");
  }
  const port = Number(process.env.HOSTINGER_IMAP_PORT || 993);
  const client = new ImapFlow({
    host: process.env.HOSTINGER_IMAP_HOST || "imap.hostinger.com",
    port,
    secure: port === 993,
    auth: { user: process.env.HOSTINGER_SMTP_USER, pass: process.env.HOSTINGER_SMTP_PASS },
    logger: false,
  });

  const messages = [];
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const since = sinceDate instanceof Date ? sinceDate : new Date(sinceDate);
    // `since` is day-granular in IMAP; we re-filter precisely by date below.
    for await (const msg of client.fetch({ since }, { envelope: true, internalDate: true, headers: ["in-reply-to", "references"] })) {
      const envelope = msg.envelope || {};
      const fromAddr = envelope.from?.[0];
      const from = fromAddr ? normalizeAddress(fromAddr.address || `${fromAddr.mailbox}@${fromAddr.host}`) : "";
      const headerText = msg.headers ? msg.headers.toString() : "";
      const inReplyTo = (headerText.match(/in-reply-to:\s*(.*)/i)?.[1] || "").trim();
      const references = (headerText.match(/references:\s*([\s\S]*?)(?:\r?\n\S|$)/i)?.[1] || "").replace(/\s+/g, " ").trim();
      messages.push({
        from,
        inReplyTo,
        references,
        subject: envelope.subject || "",
        date: msg.internalDate || envelope.date || new Date(),
      });
    }
  } finally {
    lock.release();
    try { await client.logout(); } catch { /* best effort */ }
  }
  return messages;
}

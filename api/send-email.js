import nodemailer from "nodemailer";

// Vercel serverless function: sends a single email through Hostinger SMTP.
// The browser cannot open raw SMTP sockets, so it POSTs here and this function
// relays via nodemailer. Credentials live only in Vercel env vars — never in
// the client bundle.
//
// Required environment variables (set in Vercel → Project → Settings → Env):
//   HOSTINGER_SMTP_USER  e.g. ankit@riaanitconsultants.com
//   HOSTINGER_SMTP_PASS  the mailbox password
// Optional:
//   HOSTINGER_SMTP_HOST  default "smtp.hostinger.com"
//   HOSTINGER_SMTP_PORT  default 465 (SSL)

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

    const info = await getTransport().sendMail({
      from,
      to,
      subject,
      text: body,
    });

    return res.status(200).json({ ok: true, messageId: info.messageId });
  } catch (err) {
    console.error("SMTP send failed", err);
    return res.status(502).json({ error: `SMTP send failed: ${err.message}` });
  }
}

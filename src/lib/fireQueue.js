function getFirstName(lead) {
  const name = String(lead.decisionMaker || "").trim();
  if (!name || /not (found|added|available|confirmed)/i.test(name)) return "";
  const cleanName = name.replace(/^(dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, "");
  return cleanName.split(/\s+/)[0];
}

/**
 * Processes Spintax curly bracket options (e.g. `{option1|option2}`) and
 * replaces placeholders (e.g. `{{Name}}`, `{{Company}}`, `{domain}`) case-insensitively.
 */
export function processSpintaxAndPlaceholders(text, lead, senderName = "", senderEmail = "") {
  if (!text) return "";
  let current = text;
  
  let iterations = 0;
  const maxIterations = 20;
  
  while (current.includes("{") && current.includes("}") && iterations < maxIterations) {
    iterations++;
    const nextRegex = /\{([^{}]+)\}/g;
    let replacedAny = false;
    
    current = current.replace(nextRegex, (match, innerContent) => {
      replacedAny = true;
      
      // Spintax check
      if (innerContent.includes("|")) {
        const parts = innerContent.split("|");
        const randomIndex = Math.floor(Math.random() * parts.length);
        return parts[randomIndex];
      }
      
      const cleanContent = innerContent.trim().toLowerCase();
      if (cleanContent === "name") {
        return lead.decisionMaker || lead.name || "";
      }
      if (cleanContent === "firstname" || cleanContent === "first_name") {
        return getFirstName(lead) || lead.name || "";
      }
      if (
        cleanContent === "company" ||
        cleanContent === "practice" ||
        cleanContent === "clinicname" ||
        cleanContent === "clinic_name" ||
        cleanContent === "centrename" ||
        cleanContent === "centre_name" ||
        cleanContent === "businessname" ||
        cleanContent === "business_name"
      ) {
        return lead.name || "";
      }
      if (cleanContent === "niche" || cleanContent === "specialty" || cleanContent === "industry") {
        return lead.niche || "";
      }
      if (cleanContent === "location" || cleanContent === "locality" || cleanContent === "city") {
        return lead.location || "";
      }
      if (cleanContent === "rating") {
        return lead.rating || "";
      }
      if (cleanContent === "reviews" || cleanContent === "review_count") {
        return lead.reviews || "";
      }
      if (cleanContent === "domain") {
        if (lead.email && lead.email.includes("@")) {
          return lead.email.split("@")[1];
        }
        return lead.name || "";
      }
      if (cleanContent === "year") {
        return new Date().getFullYear().toString();
      }
      if (cleanContent === "sendername" || cleanContent === "sender_name" || cleanContent === "sender") {
        return senderName || "";
      }
      if (cleanContent === "senderemail" || cleanContent === "sender_email") {
        return senderEmail || "";
      }
      
      // If unrecognized, return the inner content to strip braces
      return innerContent;
    });
    
    if (!replacedAny) break;
  }
  
  return current;
}

/**
 * Helper to parse templates from a lead's notes field.
 */
export function getOutreachTemplates(notes) {
  if (!notes) return null;
  const match = notes.match(
    /--- OUTREACH_TEMPLATES ---\r?\n([\s\S]*?)\r?\n--------------------------/
  );
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      // Look for it with different newline types
      const matchLF = notes.match(
        /--- OUTREACH_TEMPLATES ---\n([\s\S]*?)\n--------------------------/
      );
      if (matchLF) {
        try {
          return JSON.parse(matchLF[1]);
        } catch (err) {
          console.error("Failed to parse outreach templates with LF", err);
        }
      }
    }
  }
  return null;
}

/**
 * Base64url encodes an RFC 822 formatted MIME email string.
 */
export function makeRawEmail(to, subject, body, senderName = "", senderEmail = "") {
  const fullBody = body;

  // RFC 2047 MIME encoded-word syntax to handle UTF-8/non-ASCII characters in Subject header safely
  const encodedSubject = `=?UTF-8?B?${btoa(
    unescape(encodeURIComponent(subject))
  )}?=`;

  // Build From header safely if senderEmail is provided.
  // Use the sender's display name verbatim when set; otherwise send with no
  // display name so only the address shows (no forced company branding).
  let fromHeader = "";
  if (senderEmail) {
    fromHeader = senderName
      ? `From: "${senderName}" <${senderEmail}>`
      : `From: ${senderEmail}`;
  }

  const emailLines = [
    `Date: ${new Date().toUTCString()}`,
    fromHeader,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"; format=flowed',
    "Content-Transfer-Encoding: 8bit",
    "",
    fullBody,
  ].filter(Boolean);

  const rawMime = emailLines.join("\r\n");

  // Base64url encode standard web safe string
  const base64Safe = btoa(unescape(encodeURIComponent(rawMime)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return base64Safe;
}

/**
 * Dispatches an email request to the Google Gmail send API.
 */
export async function sendGmailMessage(
  accessToken,
  to,
  subject,
  body,
  senderName = "",
  senderEmail = ""
) {
  const rawBase64 = makeRawEmail(to, subject, body, senderName, senderEmail);

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: rawBase64,
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Gmail API send failed: ${response.statusText} (${errText})`
    );
  }

  return response.json();
}

/**
 * Sends a single email through the Hostinger SMTP relay (Vercel serverless
 * function at /api/send-email). The browser can't speak SMTP directly, so the
 * function holds the SMTP credentials and connection server-side.
 */
export async function sendViaSmtp(to, subject, body, senderName = "", senderEmail = "") {
  const response = await fetch("/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      subject,
      body,
      fromName: senderName,
      fromEmail: senderEmail,
    }),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const data = await response.json();
      detail = data.error || detail;
    } catch {
      // response had no JSON body
    }
    throw new Error(`SMTP send failed: ${detail}`);
  }

  return response.json();
}

/**
 * Sequential Email Queue.
 * First email fires when the queue starts. Every next email waits at least 5 minutes,
 * plus a random 0-5 minute jitter, so only one email can fire in any 5-minute window.
 */
export class FireQueue {
  constructor(options = {}) {
    this.leads = options.leads || [];
    this.accessToken = options.accessToken;
    this.provider = options.provider || "gmail"; // 'gmail' | 'smtp'
    this.sequenceStep = options.sequenceStep || "day0"; // 'day0', 'day3', 'day7'

    // Callbacks
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onLeadSent = options.onLeadSent || (() => {});
    this.onTick = options.onTick || (() => {});

    this.currentIndex = 0;
    this.status = "idle"; // 'idle', 'sending', 'paused', 'completed', 'stopped'
    this.timerId = null;
    this.countdownTimerId = null;
    this.msRemaining = 0;

    // Deliverability throttle: block duration for 1 email per block
    this.minDelayMs = options.minDelayMs || 5 * 60 * 1000;
    this.jitterDelayMs = options.jitterDelayMs || 5 * 60 * 1000;
    this.targetTime = null;

    // Session scheduling parameters
    this.sessionStartTime = null;
    this.sessionSentCount = 0;

    // Sender details for From header alignment
    this.senderName = options.senderName || "";
    this.senderEmail = options.senderEmail || "";
  }

  async sendOne() {
    if (this.status !== "sending") return;

    if (this.currentIndex >= this.leads.length) {
      this.status = "completed";
      this.onComplete();
      return;
    }

    const lead = this.leads[this.currentIndex];
    const emailAddress = lead.email;

    try {
      if (!emailAddress || !emailAddress.includes("@")) {
        throw new Error("Missing or invalid email address");
      }

      // Extract template based on selected sequence step
      const templates = getOutreachTemplates(lead.notes);
      const step = this.sequenceStep;

      const tpl = templates?.[step] || {};
      let subject = tpl.subject;
      let body = tpl.body;

      // Fallbacks if template step is missing/empty
      if (!subject || !body) {
        if (step === "day3") {
          subject =
            templates?.day3?.subject ||
            `Follow-up on proposal for ${lead.name}`;
          body =
            templates?.day3?.body ||
            `Hi, just following up on our previous email regarding ${lead.name}.`;
        } else if (step === "day7") {
          subject =
            templates?.day7?.subject || `Final follow-up for ${lead.name}`;
          body =
            templates?.day7?.body ||
            `Hi, wanted to reach out one last time regarding ${lead.name}.`;
        } else {
          subject =
            templates?.day0?.subject || `Concept proposal for ${lead.name}`;
          body =
            templates?.day0?.body ||
            `Hi, we sketched a mock concept for ${lead.name}. Open to taking a look?`;
        }
      }

      // Resolve spintax and placeholders in subject and body
      const resolvedSubject = processSpintaxAndPlaceholders(subject, lead, this.senderName, this.senderEmail);
      const resolvedBody = processSpintaxAndPlaceholders(body, lead, this.senderName, this.senderEmail);

      // Dispatch single email via the selected provider.
      if (this.provider === "smtp") {
        await sendViaSmtp(
          emailAddress,
          resolvedSubject,
          resolvedBody,
          this.senderName,
          this.senderEmail
        );
      } else {
        await sendGmailMessage(
          this.accessToken,
          emailAddress,
          resolvedSubject,
          resolvedBody,
          this.senderName,
          this.senderEmail
        );
      }
      this.onLeadSent(lead, null);
    } catch (err) {
      this.onLeadSent(lead, err);
    }

    this.currentIndex++;
    this.sessionSentCount++;
    this.onProgress(this.currentIndex, this.leads.length);

    if (this.status !== "sending") return;

    // Check if all done
    if (this.currentIndex >= this.leads.length) {
      this.status = "completed";
      this.onComplete();
      return;
    }

    this.scheduleNext();
  }

  scheduleNext() {
    if (this.timerId) clearTimeout(this.timerId);

    // Schedule the next lead to be sent at a randomized offset within its session block.
    // Each block is this.minDelayMs (e.g. 5 minutes).
    // The targetOffset is a random value within [sessionSentCount * blockMs, (sessionSentCount + 1) * blockMs]
    const blockDurationMs = this.minDelayMs;
    const targetOffset = this.sessionSentCount * blockDurationMs + Math.random() * blockDurationMs;
    const targetTime = this.sessionStartTime + targetOffset;
    const delayMs = Math.max(0, targetTime - Date.now());

    this.targetTime = targetTime;
    this.msRemaining = delayMs;

    this.startCountdown();
    this.timerId = setTimeout(() => {
      this.sendOne();
    }, delayMs);
  }

  startCountdown() {
    if (this.countdownTimerId) clearInterval(this.countdownTimerId);
    this.onTick(this.msRemaining);

    this.countdownTimerId = setInterval(() => {
      this.msRemaining = Math.max(0, this.msRemaining - 1000);
      this.onTick(this.msRemaining);
      if (this.msRemaining <= 0) {
        clearInterval(this.countdownTimerId);
      }
    }, 1000);
  }

  start() {
    if (this.status === "sending") return;
    this.status = "sending";

    // Initialize session variables starting from now
    this.sessionStartTime = Date.now();
    this.sessionSentCount = 0;

    this.scheduleNext();
  }

  pause() {
    this.status = "paused";
    if (this.timerId) clearTimeout(this.timerId);
    if (this.countdownTimerId) clearInterval(this.countdownTimerId);
    this.timerId = null;
    this.countdownTimerId = null;
    if (this.targetTime) {
      this.msRemaining = Math.max(0, this.targetTime - Date.now());
    }
    this.onTick(this.msRemaining);
  }

  stop() {
    this.status = "stopped";
    if (this.timerId) clearTimeout(this.timerId);
    if (this.countdownTimerId) clearInterval(this.countdownTimerId);
    this.timerId = null;
    this.countdownTimerId = null;
    this.currentIndex = 0;
    this.msRemaining = 0;
    this.targetTime = null;
    this.onTick(0);
  }
}

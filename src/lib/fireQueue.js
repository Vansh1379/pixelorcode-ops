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
export function makeRawEmail(to, subject, body, globalSignature = "", senderName = "", senderEmail = "") {
  const fullBody = globalSignature ? `${body}\n\n${globalSignature}` : body;

  // RFC 2047 MIME encoded-word syntax to handle UTF-8/non-ASCII characters in Subject header safely
  const encodedSubject = `=?UTF-8?B?${btoa(
    unescape(encodeURIComponent(subject))
  )}?=`;

  // Build From header safely if senderEmail is provided.
  // Add company branding to display name if present.
  let fromHeader = "";
  if (senderEmail) {
    const displayName = senderName ? `${senderName} | PixelOrCode` : "PixelOrCode";
    fromHeader = `From: "${displayName}" <${senderEmail}>`;
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
  globalSignature = "",
  senderName = "",
  senderEmail = ""
) {
  const rawBase64 = makeRawEmail(to, subject, body, globalSignature, senderName, senderEmail);

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
 * Sequential Email Queue.
 * First email fires when the queue starts. Every next email waits at least 5 minutes,
 * plus a random 0-5 minute jitter, so only one email can fire in any 5-minute window.
 */
export class FireQueue {
  constructor(options = {}) {
    this.leads = options.leads || [];
    this.accessToken = options.accessToken;
    this.globalSignature = options.globalSignature || "";
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

      // Dispatch single email to API
      await sendGmailMessage(
        this.accessToken,
        emailAddress,
        subject,
        body,
        this.globalSignature,
        this.senderName,
        this.senderEmail
      );
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

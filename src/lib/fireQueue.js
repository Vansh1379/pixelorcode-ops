/**
 * Helper to parse templates from a lead's notes field.
 */
export function getOutreachTemplates(notes) {
  if (!notes) return null;
  const match = notes.match(/--- OUTREACH_TEMPLATES ---\r?\n([\s\S]*?)\r?\n--------------------------/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      // Look for it with different newline types
      const matchLF = notes.match(/--- OUTREACH_TEMPLATES ---\n([\s\S]*?)\n--------------------------/);
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
export function makeRawEmail(to, subject, body, globalSignature = "") {
  const fullBody = globalSignature 
    ? `${body}\n\n${globalSignature}`
    : body;

  // RFC 2047 MIME encoded-word syntax to handle UTF-8/non-ASCII characters in Subject header safely
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;

  const emailLines = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    fullBody
  ];
  
  const rawMime = emailLines.join('\r\n');
  
  // Base64url encode standard web safe string
  const base64Safe = btoa(unescape(encodeURIComponent(rawMime)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
    
  return base64Safe;
}

/**
 * Dispatches an email request to the Google Gmail send API.
 */
export async function sendGmailMessage(accessToken, to, subject, body, globalSignature = "") {
  const rawBase64 = makeRawEmail(to, subject, body, globalSignature);
  
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      raw: rawBase64
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gmail API send failed: ${response.statusText} (${errText})`);
  }

  return response.json();
}

/**
 * Sequential Email Queue — sends one email at a time with a RANDOM delay (1–10 min) between each.
 * First email fires instantly, then waits a random 1–10 minutes before the next one.
 * Randomized gaps prevent Gmail from detecting a pattern and marking emails as spam.
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
  }

  /** Returns a random delay between 1 and 10 minutes (in ms) */
  getRandomDelay() {
    const minMinutes = 1;
    const maxMinutes = 10;
    const randomMinutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
    return Math.round(randomMinutes * 60 * 1000);
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
          subject = templates?.day3?.subject || `Follow-up on proposal for ${lead.name}`;
          body = templates?.day3?.body || `Hi, just following up on our previous email regarding ${lead.name}.`;
        } else if (step === "day7") {
          subject = templates?.day7?.subject || `Final follow-up for ${lead.name}`;
          body = templates?.day7?.body || `Hi, wanted to reach out one last time regarding ${lead.name}.`;
        } else {
          subject = templates?.day0?.subject || `Concept proposal for ${lead.name}`;
          body = templates?.day0?.body || `Hi, we sketched a mock concept for ${lead.name}. Open to taking a look?`;
        }
      }

      // Dispatch single email to API
      await sendGmailMessage(this.accessToken, emailAddress, subject, body, this.globalSignature);
      this.onLeadSent(lead, null);
    } catch (err) {
      this.onLeadSent(lead, err);
    }

    this.currentIndex++;
    this.onProgress(this.currentIndex, this.leads.length);

    // Check if all done
    if (this.currentIndex >= this.leads.length) {
      this.status = "completed";
      this.onComplete();
      return;
    }

    // Generate a fresh random delay (1–10 minutes) before sending the next email
    const randomDelayMs = this.getRandomDelay();
    this.msRemaining = randomDelayMs;
    this.startCountdown();
    this.timerId = setTimeout(() => {
      this.sendOne();
    }, randomDelayMs);
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
    this.sendOne();
  }

  pause() {
    this.status = "paused";
    if (this.timerId) clearTimeout(this.timerId);
    if (this.countdownTimerId) clearInterval(this.countdownTimerId);
    this.timerId = null;
    this.countdownTimerId = null;
    this.msRemaining = 0;
  }

  stop() {
    this.status = "stopped";
    if (this.timerId) clearTimeout(this.timerId);
    if (this.countdownTimerId) clearInterval(this.countdownTimerId);
    this.timerId = null;
    this.countdownTimerId = null;
    this.currentIndex = 0;
    this.msRemaining = 0;
  }
}


import assert from "node:assert/strict";
import test from "node:test";

process.env.EMAIL_TOKEN_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
process.env.OAUTH_STATE_SECRET = "0123456789abcdef0123456789abcdef";
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";

const cryptoHelpers = await import("../server/tokenCrypto.js");
const { sendGmailMail } = await import("../server/gmail.js");
const templates = await import("../src/lib/fireQueue.js");
const { normalizeScheduledAt } = await import("../server/campaignSchedule.js");
const { formatMailboxFrom } = await import("../server/senderIdentity.js");
const { getCampaignNotificationEmail } = await import("../server/campaignNotification.js");
const { makeThreadedSubject, normalizeMessageId, previousSequenceSteps } = await import("../server/emailThreading.js");

test("encrypts refresh tokens and rejects tampering", () => {
  const encrypted = cryptoHelpers.encryptSecret("refresh-token-value");
  assert.notEqual(encrypted, "refresh-token-value");
  assert.equal(cryptoHelpers.decryptSecret(encrypted), "refresh-token-value");
  assert.throws(() => cryptoHelpers.decryptSecret(`${encrypted}x`));
});

test("signs OAuth state, verifies expiry, and rejects tampering", () => {
  const signed = cryptoHelpers.signOAuthState({ userId: "user-1", exp: Date.now() + 10_000 });
  assert.equal(cryptoHelpers.verifyOAuthState(signed).userId, "user-1");
  assert.throws(() => cryptoHelpers.verifyOAuthState(`${signed}x`));
  const expired = cryptoHelpers.signOAuthState({ userId: "user-1", exp: Date.now() - 1 });
  assert.throws(() => cryptoHelpers.verifyOAuthState(expired), /expired/);
});

test("extracts templates and resolves lead and sender placeholders", () => {
  const notes = `--- OUTREACH_TEMPLATES ---\n${JSON.stringify({
    day0: { subject: "Idea for {company}", body: "Hi {firstname}, email me at {senderemail}." },
  })}\n--------------------------\n`;
  assert.equal(templates.getOutreachTemplates(notes).day0.subject, "Idea for {company}");
  const lead = { name: "Acme Clinic", decisionMaker: "Dr. Priya Sharma" };
  assert.equal(
    templates.processSpintaxAndPlaceholders("Hi {firstname} from {company} — {senderemail}", lead, "", "sales@example.com"),
    "Hi Priya from Acme Clinic — sales@example.com",
  );
});

test("formats the configured SMTP mailbox display name safely", () => {
  assert.equal(
    formatMailboxFrom("ankit@riaanitconsultants.com", "", "Riaan IT Consultants"),
    '"Riaan IT Consultants" <ankit@riaanitconsultants.com>',
  );
  assert.equal(
    formatMailboxFrom("sender@example.com", 'Bad\r\n"Name', "Fallback"),
    '"BadName" <sender@example.com>',
  );
});

test("uses Vansh's inbox for campaign lifecycle notifications", () => {
  const original = process.env.CAMPAIGN_NOTIFICATION_EMAIL;
  delete process.env.CAMPAIGN_NOTIFICATION_EMAIL;
  assert.equal(getCampaignNotificationEmail(), "vanshkalra1379@gmail.com");
  process.env.CAMPAIGN_NOTIFICATION_EMAIL = "alerts@example.com";
  assert.equal(getCampaignNotificationEmail(), "alerts@example.com");
  if (original == null) delete process.env.CAMPAIGN_NOTIFICATION_EMAIL;
  else process.env.CAMPAIGN_NOTIFICATION_EMAIL = original;
});

test("builds stable follow-up thread metadata", () => {
  assert.equal(normalizeMessageId("original@example.com"), "<original@example.com>");
  assert.equal(makeThreadedSubject("Re: Original proposal", "Different follow-up"), "Re: Original proposal");
  assert.deepEqual(previousSequenceSteps("day3"), ["day0"]);
  assert.deepEqual(previousSequenceSteps("day7"), ["day3", "day0"]);
  assert.deepEqual(previousSequenceSteps("day0"), []);
});

test("refreshes offline Gmail access and sends the expected MIME message", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fresh-access-token" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: "gmail-message-123", threadId: "gmail-thread-123" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await sendGmailMail({
      connection: { encrypted_refresh_token: cryptoHelpers.encryptSecret("stored-refresh-token") },
      to: "lead@example.com",
      subject: "Hello ✓",
      body: "Test body",
      senderEmail: "sender@gmail.com",
    });
    assert.equal(result.messageId, "gmail-message-123");
    assert.equal(result.threadId, "gmail-thread-123");
    assert.equal(calls.length, 2);
    assert.match(String(calls[0].options.body), /refresh_token=stored-refresh-token/);
    assert.equal(calls[1].options.headers.Authorization, "Bearer fresh-access-token");
    const raw = JSON.parse(calls[1].options.body).raw;
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    assert.match(decoded, /From: sender@gmail.com/);
    assert.match(decoded, /To: lead@example.com/);
    assert.match(decoded, /Test body/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sends Gmail follow-ups inside the previous provider thread", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({ access_token: "fresh-access-token" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (String(url).includes("/messages/prior-gmail-id?")) {
      return new Response(JSON.stringify({
        id: "prior-gmail-id",
        threadId: "existing-thread-id",
        payload: { headers: [{ name: "Message-ID", value: "<original@example.com>" }] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ id: "follow-up-id", threadId: "existing-thread-id" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await sendGmailMail({
      connection: { encrypted_refresh_token: cryptoHelpers.encryptSecret("stored-refresh-token") },
      to: "lead@example.com",
      subject: "Re: Original proposal",
      body: "Following up",
      senderEmail: "sender@gmail.com",
      replyTo: { providerMessageId: "prior-gmail-id" },
    });
    assert.equal(result.threadId, "existing-thread-id");
    assert.equal(calls.length, 3);
    const request = JSON.parse(calls[2].options.body);
    assert.equal(request.threadId, "existing-thread-id");
    const decoded = Buffer.from(request.raw, "base64url").toString("utf8");
    assert.match(decoded, /In-Reply-To: <original@example.com>/);
    assert.match(decoded, /References: <original@example.com>/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test("campaign and connection APIs reject unauthenticated requests", async () => {
  const [{ default: campaigns }, { default: connections }, { default: googleOAuth }] = await Promise.all([
    import("../api/campaigns.js"),
    import("../api/email-connections.js"),
    import("../api/google-oauth.js"),
  ]);
  for (const handler of [campaigns, connections, googleOAuth]) {
    const res = responseRecorder();
    await handler({ method: "GET", headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.match(res.payload.error, /Authentication required/);
  }
});

test("Inngest Vercel endpoint registers without throwing", async () => {
  const module = await import("../api/inngest.js");
  assert.equal(typeof module.default, "function");
});

test("normalizes immediate and future campaign schedules", () => {
  const now = Date.parse("2026-07-11T08:00:00.000Z");
  assert.equal(normalizeScheduledAt(undefined, now), "2026-07-11T08:00:00.000Z");
  assert.equal(
    normalizeScheduledAt("2026-07-11T13:30:00.000Z", now),
    "2026-07-11T13:30:00.000Z",
  );
});

test("rejects invalid, past, and beyond-free-tier schedules", () => {
  const now = Date.parse("2026-07-11T08:00:00.000Z");
  assert.throws(() => normalizeScheduledAt("not-a-date", now), /Invalid/);
  assert.throws(() => normalizeScheduledAt("2026-07-11T07:00:00.000Z", now), /future/);
  assert.throws(() => normalizeScheduledAt("2026-07-19T08:00:00.000Z", now), /7 days/);
});

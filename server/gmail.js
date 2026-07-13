import { decryptSecret } from "./tokenCrypto.js";
import { createRfcMessageId, normalizeMessageId } from "./emailThreading.js";

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function makeRawEmail({ to, subject, body, senderEmail, senderName = "", messageId, inReplyTo = "" }) {
  const safeName = senderName.replace(/[\r\n"]/g, "");
  const from = safeName ? `"${safeName}" <${senderEmail}>` : senderEmail;
  const replyMessageId = normalizeMessageId(inReplyTo);
  return encodeBase64Url([
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${normalizeMessageId(messageId)}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    ...(replyMessageId ? [`In-Reply-To: ${replyMessageId}`, `References: ${replyMessageId}`] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n"));
}

async function loadGmailReplyMetadata(accessToken, providerMessageId) {
  if (!providerMessageId) return {};
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}?format=metadata&metadataHeaders=Message-ID`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(`Gmail thread lookup failed: ${data.error?.message || response.status}`);
  const messageId = data.payload?.headers?.find((header) => header.name?.toLowerCase() === "message-id")?.value || "";
  return { threadId: data.threadId || "", rfcMessageId: normalizeMessageId(messageId) };
}

async function refreshAccessToken(encryptedRefreshToken) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: decryptSecret(encryptedRefreshToken),
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(`Gmail authorization refresh failed: ${data.error_description || data.error || response.status}`);
  }
  return data.access_token;
}

export async function sendGmailMail({ connection, to, subject, body, senderEmail, replyTo = null }) {
  const accessToken = await refreshAccessToken(connection.encrypted_refresh_token);
  let threadId = replyTo?.threadId || "";
  let inReplyTo = normalizeMessageId(replyTo?.rfcMessageId);
  if (replyTo?.providerMessageId && (!threadId || !inReplyTo)) {
    const metadata = await loadGmailReplyMetadata(accessToken, replyTo.providerMessageId);
    threadId ||= metadata.threadId;
    inReplyTo ||= metadata.rfcMessageId;
  }
  const rfcMessageId = createRfcMessageId(senderEmail);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw: makeRawEmail({ to, subject, body, senderEmail, messageId: rfcMessageId, inReplyTo }),
      ...(threadId ? { threadId } : {}),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Gmail send failed: ${data.error?.message || response.status}`);
  return { messageId: data.id || "", threadId: data.threadId || threadId, rfcMessageId };
}

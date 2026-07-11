import { decryptSecret } from "./tokenCrypto.js";

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function makeRawEmail({ to, subject, body, senderEmail, senderName = "" }) {
  const safeName = senderName.replace(/[\r\n"]/g, "");
  const from = safeName ? `"${safeName}" <${senderEmail}>` : senderEmail;
  return encodeBase64Url([
    `Date: ${new Date().toUTCString()}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ].join("\r\n"));
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

export async function sendGmailMail({ connection, to, subject, body, senderEmail }) {
  const accessToken = await refreshAccessToken(connection.encrypted_refresh_token);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: makeRawEmail({ to, subject, body, senderEmail }) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Gmail send failed: ${data.error?.message || response.status}`);
  return { messageId: data.id || "" };
}

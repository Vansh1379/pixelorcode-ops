import crypto from "node:crypto";

function key() {
  const raw = process.env.EMAIL_TOKEN_ENCRYPTION_KEY || "";
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new Error("EMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return decoded;
}

export function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value) {
  const [ivRaw, tagRaw, encryptedRaw] = String(value || "").split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Stored token is invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function signOAuthState(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const secret = process.env.OAUTH_STATE_SECRET || "";
  if (secret.length < 32) throw new Error("OAUTH_STATE_SECRET must contain at least 32 characters.");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyOAuthState(value) {
  const [encoded, signature] = String(value || "").split(".");
  if (!encoded || !signature) throw new Error("Invalid OAuth state.");
  const expected = crypto.createHmac("sha256", process.env.OAUTH_STATE_SECRET || "").update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new Error("Invalid OAuth state signature.");
  }
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!payload.exp || Date.now() > payload.exp) throw new Error("OAuth state has expired.");
  return payload;
}

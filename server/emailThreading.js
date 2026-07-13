import { randomUUID } from "node:crypto";

export function createRfcMessageId(senderEmail = "") {
  const domain = String(senderEmail).split("@")[1]?.replace(/[^a-z0-9.-]/gi, "") || "pixelorcode.local";
  return `<${randomUUID()}@${domain}>`;
}

export function normalizeMessageId(value = "") {
  const clean = String(value).replace(/[\r\n]/g, "").trim();
  if (!clean) return "";
  return clean.startsWith("<") && clean.endsWith(">") ? clean : `<${clean.replace(/[<>]/g, "")}>`;
}

export function makeThreadedSubject(previousSubject = "", fallbackSubject = "") {
  const subject = String(previousSubject || fallbackSubject).trim().replace(/^(\s*re\s*:\s*)+/i, "");
  return subject ? `Re: ${subject}` : String(fallbackSubject || "Follow-up").trim();
}

export function previousSequenceSteps(sequenceStep) {
  if (sequenceStep === "day3") return ["day0"];
  if (sequenceStep === "day7") return ["day3", "day0"];
  return [];
}

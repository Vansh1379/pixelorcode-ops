const MAX_HOBBY_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const PAST_TOLERANCE_MS = 60 * 1000;

export function normalizeScheduledAt(value, nowMs = Date.now()) {
  if (!value) return new Date(nowMs).toISOString();
  const scheduledMs = Date.parse(value);
  if (!Number.isFinite(scheduledMs)) {
    const error = new Error("Invalid scheduled date or time.");
    error.statusCode = 400;
    throw error;
  }
  if (scheduledMs < nowMs - PAST_TOLERANCE_MS) {
    const error = new Error("Scheduled time must be in the future.");
    error.statusCode = 400;
    throw error;
  }
  if (scheduledMs > nowMs + MAX_HOBBY_DELAY_MS) {
    const error = new Error("The Inngest free plan supports scheduling up to 7 days ahead.");
    error.statusCode = 400;
    throw error;
  }
  return new Date(Math.max(scheduledMs, nowMs)).toISOString();
}

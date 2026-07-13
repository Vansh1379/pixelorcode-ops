const DEFAULT_CAMPAIGN_NOTIFICATION_EMAIL = "vanshkalra1379@gmail.com";

export function getCampaignNotificationEmail() {
  return String(process.env.CAMPAIGN_NOTIFICATION_EMAIL || DEFAULT_CAMPAIGN_NOTIFICATION_EMAIL).trim();
}

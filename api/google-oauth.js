import crypto from "node:crypto";
import { getSupabaseAdmin, requireApiUser } from "../server/supabaseAdmin.js";
import { encryptSecret, signOAuthState, verifyOAuthState } from "../server/tokenCrypto.js";

function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}/api/google-oauth`;
}

function appOrigin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (req.query?.code || req.query?.error) {
      if (req.query.error) throw new Error(`Google authorization failed: ${req.query.error}`);
      const state = verifyOAuthState(req.query.state);
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: process.env.GOOGLE_CLIENT_ID || "",
          client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
          redirect_uri: redirectUri(req),
          grant_type: "authorization_code",
        }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.refresh_token) {
        throw new Error(tokens.error_description || "Google did not return offline access. Revoke access and connect again.");
      }

      const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileResponse.json();
      if (!profileResponse.ok || !profile.email) throw new Error("Could not read the connected Google email address.");

      const admin = getSupabaseAdmin();
      const { error } = await admin.from("email_connections").upsert({
        user_id: state.userId,
        provider: "gmail",
        email_address: profile.email,
        display_name: profile.name || "",
        encrypted_refresh_token: encryptSecret(tokens.refresh_token),
        scopes: tokens.scope || "https://www.googleapis.com/auth/gmail.send",
        status: "connected",
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider,email_address" });
      if (error) throw error;
      return res.redirect(302, `${appOrigin(req)}/#bulk-fire`);
    }

    const user = await requireApiUser(req);
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(500).json({ error: "Server-side Google OAuth is not configured." });
    }
    const state = signOAuthState({
      userId: user.id,
      nonce: crypto.randomBytes(16).toString("hex"),
      exp: Date.now() + 10 * 60 * 1000,
    });
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(req),
      response_type: "code",
      access_type: "offline",
      // Always show the chooser so the same PixelOrCode user can connect
      // several different Gmail/Workspace mailboxes to this one OAuth app.
      prompt: "consent select_account",
      include_granted_scopes: "true",
      scope: "openid email profile https://www.googleapis.com/auth/gmail.send",
      state,
    });
    return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  } catch (error) {
    if (req.query?.code || req.query?.error) {
      return res.redirect(302, `${appOrigin(req)}/#bulk-fire`);
    }
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
}

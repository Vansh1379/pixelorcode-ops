import { getSupabaseAdmin, requireApiUser } from "../server/supabaseAdmin.js";
import { decryptSecret } from "../server/tokenCrypto.js";

export default async function handler(req, res) {
  try {
    const user = await requireApiUser(req);
    const admin = getSupabaseAdmin();
    if (req.method === "GET") {
      const { data, error } = await admin.from("email_connections")
        .select("id, provider, email_address, display_name, status, last_used_at, created_at")
        .eq("user_id", user.id)
        .eq("status", "connected")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.status(200).json({ connections: data || [] });
    }
    if (req.method === "DELETE") {
      const id = String(req.query?.id || "");
      const { data: connection } = await admin.from("email_connections")
        .select("encrypted_refresh_token").eq("id", id).eq("user_id", user.id).maybeSingle();
      if (connection?.encrypted_refresh_token) {
        try {
          await fetch("https://oauth2.googleapis.com/revoke", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token: decryptSecret(connection.encrypted_refresh_token) }),
          });
        } catch (error) {
          console.error("Google token revocation failed", error);
        }
      }
      const { error } = await admin.from("email_connections")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
}

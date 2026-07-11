import { createClient } from "@supabase/supabase-js";

let adminClient;

export function getSupabaseAdmin() {
  if (adminClient) return adminClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server Supabase credentials are not configured.");
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export async function requireApiUser(req) {
  const header = String(req.headers.authorization || "");
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    const error = new Error("Authentication required.");
    error.statusCode = 401;
    throw error;
  }
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) {
    const authError = new Error("Invalid or expired session.");
    authError.statusCode = 401;
    throw authError;
  }
  return data.user;
}

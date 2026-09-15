import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * サーバー側(Netlify Functions)専用のSupabaseクライアント。
 * service_role キーを使うのでブラウザ等には絶対に露出させないこと。
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が環境変数に設定されていません(.env または Netlify の環境変数設定を確認)"
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false },
  });
  return cached;
}

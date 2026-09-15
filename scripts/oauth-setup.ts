/**
 * freeeの初回OAuth認可を行い、access_token/refresh_tokenをSupabaseに保存するスクリプト。
 *
 * 使い方:
 *   1. `AUTHORIZE_URL` をブラウザで開いてfreeeにログイン・許可する(ユーザー本人の操作が必要)
 *   2. 遷移先URLの ?code=xxxx の xxxx をコピーする
 *   3. `npx tsx scripts/oauth-setup.ts <code>` を実行する
 *
 * .env に FREEE_CLIENT_ID / FREEE_CLIENT_SECRET / FREEE_REDIRECT_URI /
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が設定されている前提。
 */
import "dotenv/config";
import { exchangeCodeForToken, listCompanies, AUTHORIZE_URL } from "../src/lib/freee";
import { getSupabase } from "../src/lib/supabase";

async function main() {
  const code = process.argv[2];
  const clientId = process.env.FREEE_CLIENT_ID;
  const redirectUri = process.env.FREEE_REDIRECT_URI;

  if (!code) {
    const url = `${AUTHORIZE_URL}?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri ?? ""
    )}&response_type=code`;
    console.log("以下のURLをブラウザで開いて認可し、遷移先の code=... をコピーしてください:\n");
    console.log(url);
    console.log("\nその後: npx tsx scripts/oauth-setup.ts <code> を実行してください。");
    return;
  }

  const token = await exchangeCodeForToken(code);
  const supabase = getSupabase();
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

  const { error } = await supabase.from("freee_tokens").upsert({
    id: 1,
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  console.log("トークンをSupabaseに保存しました。");

  const companies = await listCompanies(token.access_token);
  console.log("\nこのアカウントに紐づく事業所一覧(company_id を .env の FREEE_COMPANY_ID に設定してください):");
  companies.forEach((c) => console.log(`  id=${c.id}  ${c.display_name ?? c.name}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

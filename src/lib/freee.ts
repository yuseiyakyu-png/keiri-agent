import { getSupabase } from "./supabase";

const TOKEN_URL = "https://accounts.secure.freee.co.jp/public_api/token";
export const AUTHORIZE_URL = "https://accounts.secure.freee.co.jp/public_api/authorize";
const API_BASE = "https://api.freee.co.jp";

export interface UnmatchedTxn {
  id: number;
  date: string;
  amount: number; // 内部的には支出=負, 収入=正 として扱う(freee側は常に正の値+entry_sideで表現)
  description: string; // 摘要
  walletableId: number;
  walletableType: string;
}

interface FreeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // 秒
}

/** 初回OAuth認可で受け取ったcodeをトークンに交換する(scripts/oauth-setup.ts から利用) */
export async function exchangeCodeForToken(code: string): Promise<FreeeTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.FREEE_CLIENT_ID ?? "",
      client_secret: process.env.FREEE_CLIENT_SECRET ?? "",
      code,
      redirect_uri: process.env.FREEE_REDIRECT_URI ?? "",
    }),
  });
  if (!res.ok) {
    throw new Error(`freeeトークン取得に失敗: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<FreeeTokenResponse>;
}

async function refreshAccessToken(refreshToken: string): Promise<FreeeTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.FREEE_CLIENT_ID ?? "",
      client_secret: process.env.FREEE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`freeeトークン更新に失敗: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<FreeeTokenResponse>;
}

/**
 * Supabaseに保存された最新のトークンを返す。有効期限が近ければ自動でrefreshし、
 * ローテーションされる新しいrefresh_tokenをSupabaseに書き戻す。
 */
export async function getValidAccessToken(): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("freee_tokens").select("*").eq("id", 1).single();
  if (error || !data) {
    throw new Error(
      "freeeのトークンが保存されていません。先に `npm run oauth-setup` で初回認可を行ってください。"
    );
  }

  const expiresAt = new Date(data.expires_at).getTime();
  const bufferMs = 5 * 60 * 1000; // 5分の余裕を持って早めに更新
  if (expiresAt - Date.now() > bufferMs) {
    return data.access_token;
  }

  const refreshed = await refreshAccessToken(data.refresh_token);
  const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

  const { error: updateError } = await supabase
    .from("freee_tokens")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (updateError) throw updateError;

  return refreshed.access_token;
}

async function freeeGet(path: string, accessToken: string, params: Record<string, string | number> = {}) {
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`freee GET ${path} 失敗: ${res.status} ${await res.text()}`);
  return res.json();
}

async function freeePost(path: string, accessToken: string, body: unknown) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`freee POST ${path} 失敗: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * 未処理の明細(自動で経理)を取得する。
 * freeeのwallet_txnsは amount が常に正の値で、entry_side("income"|"expense")で方向を表す。
 * status === 1 が「未処理(まだ取引/仕訳になっていない)」であることをテスト事業所で確認済み。
 */
export async function fetchUnmatchedWalletTxns(accessToken: string, companyId: number): Promise<UnmatchedTxn[]> {
  const data: any = await freeeGet("/api/1/wallet_txns", accessToken, {
    company_id: companyId,
  });
  const list: any[] = data.wallet_txns ?? [];
  return list
    .filter((w) => w.status === 1)
    .map((w) => ({
      id: w.id,
      date: w.date,
      amount: w.entry_side === "expense" ? -Math.abs(w.amount) : Math.abs(w.amount),
      description: w.description ?? "",
      walletableId: w.walletable_id,
      walletableType: w.walletable_type,
    }));
}

/** 事業所一覧からcompany_idを調べるための補助関数(初回セットアップ時に利用) */
export async function listCompanies(accessToken: string) {
  const data: any = await freeeGet("/api/1/companies", accessToken);
  return data.companies as { id: number; name: string; display_name: string }[];
}

/** 勘定科目名からaccount_item_idを調べる */
export async function findAccountItemId(
  accessToken: string,
  companyId: number,
  name: string
): Promise<number | null> {
  const data: any = await freeeGet("/api/1/account_items", accessToken, { company_id: companyId });
  const items: any[] = data.account_items ?? [];
  const found = items.find((i) => i.name === name);
  return found ? found.id : null;
}

/**
 * 一致した明細を取引(仕訳)として登録する。
 * TODO: tax_codeや勘定科目マッピングは、テスト事業所の実データで必ず動作確認すること。
 */
export async function registerDeal(
  accessToken: string,
  companyId: number,
  txn: UnmatchedTxn,
  accountItemId: number
) {
  return freeePost("/api/1/deals", accessToken, {
    company_id: companyId,
    issue_date: txn.date,
    type: txn.amount < 0 ? "expense" : "income",
    details: [
      {
        account_item_id: accountItemId,
        tax_code: 0,
        amount: Math.abs(txn.amount),
        description: txn.description,
      },
    ],
    wallet_txn_id: txn.id,
  });
}

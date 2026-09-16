import { getSupabase } from "./supabase";
import { getValidAccessToken, fetchUnmatchedWalletTxns, findAccountItemId, registerDeal } from "./freee";
import { matchExact, type MatchingRule, type MatchedItem } from "./match";
import { postReportToSlack } from "./slack";

export interface RunResult {
  totalUnmatched: number;
  registeredCount: number;
  registeredItems: { description: string; account_item_name: string }[];
}

/**
 * 経理AIエージェントの1回分の処理本体。
 * 毎朝の自動実行(daily-run)と、手動テスト用(manual-run)の両方からここを呼ぶ。
 */
export async function runDailyJob(): Promise<RunResult> {
  const supabase = getSupabase();
  const companyId = Number(process.env.FREEE_COMPANY_ID);
  const slackWebhook = process.env.SLACK_WEBHOOK_URL;
  if (!companyId) throw new Error("FREEE_COMPANY_ID が設定されていません");
  if (!slackWebhook) throw new Error("SLACK_WEBHOOK_URL が設定されていません");

  try {
    const accessToken = await getValidAccessToken();

    const { data: rulesData, error: rulesError } = await supabase
      .from("matching_rules")
      .select("keyword, account_item_name");
    if (rulesError) throw rulesError;
    const rules = (rulesData ?? []) as MatchingRule[];

    const txns = await fetchUnmatchedWalletTxns(accessToken, companyId);
    const allMatched = matchExact(txns, rules);

    // freeeの仕様上、仕訳登録後もwallet_txn.statusが「未処理」のまま変わらない
    // (公開APIでの連携不可という既知の制限)ため、こちら側のSupabaseで
    // 「もう登録した明細id」を記録し、二重登録を防ぐ。
    const matchedIds = allMatched.map((m) => m.txn.id);
    let alreadyRegisteredIds = new Set<number>();
    if (matchedIds.length > 0) {
      const { data: alreadyData, error: alreadyError } = await supabase
        .from("registered_wallet_txns")
        .select("wallet_txn_id")
        .in("wallet_txn_id", matchedIds);
      if (alreadyError) throw alreadyError;
      alreadyRegisteredIds = new Set((alreadyData ?? []).map((r: any) => r.wallet_txn_id));
    }
    const matched = allMatched.filter((m) => !alreadyRegisteredIds.has(m.txn.id));

    // 勘定科目名 -> account_item_id のキャッシュ(同じ科目を何度も引かないため)
    const accountItemIdCache = new Map<string, number | null>();
    const registeredItems: RunResult["registeredItems"] = [];
    const registeredMatchedItems: MatchedItem[] = [];

    for (const m of matched) {
      let accountItemId = accountItemIdCache.get(m.rule.account_item_name);
      if (accountItemId === undefined) {
        accountItemId = await findAccountItemId(accessToken, companyId, m.rule.account_item_name);
        accountItemIdCache.set(m.rule.account_item_name, accountItemId);
      }
      if (!accountItemId) {
        // 勘定科目がfreee側に見つからない場合はスキップし、ログに残す(黙って落とさない)
        console.error(`勘定科目が見つかりません: ${m.rule.account_item_name}`);
        continue;
      }
      await registerDeal(accessToken, companyId, m.txn, accountItemId);
      await supabase
        .from("registered_wallet_txns")
        .upsert({ wallet_txn_id: m.txn.id }, { onConflict: "wallet_txn_id" });
      registeredItems.push({ description: m.txn.description, account_item_name: m.rule.account_item_name });
      registeredMatchedItems.push(m);
    }

    await postReportToSlack(slackWebhook, txns.length, registeredMatchedItems);

    await supabase.from("run_logs").insert({
      total_unmatched: txns.length,
      registered_count: registeredItems.length,
      registered_items: registeredItems,
      status: "success",
    });

    return {
      totalUnmatched: txns.length,
      registeredCount: registeredItems.length,
      registeredItems,
    };
  } catch (err: any) {
    await supabase.from("run_logs").insert({
      status: "error",
      error_message: String(err?.message ?? err),
    });
    throw err;
  }
}

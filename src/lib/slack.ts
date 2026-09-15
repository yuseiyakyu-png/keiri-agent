import type { MatchedItem } from "./match";

/** ゴールに提示された投稿フォーマットに合わせてSlackへ報告する */
export async function postReportToSlack(webhookUrl: string, totalUnmatched: number, matched: MatchedItem[]) {
  const grouped = new Map<string, number>();
  for (const m of matched) {
    const key = `${m.txn.description} / ${m.rule.account_item_name}`;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  const lines = Array.from(grouped.entries()).map(([key, count]) => `・${key} ×${count}`);
  const remaining = totalUnmatched - matched.length;

  const text = [
    `今日の未仕訳 ${totalUnmatched}件のうち、${matched.length}件を登録しました。`,
    ...lines,
    `残り${remaining}件は未処理です。`,
  ].join("\n");

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Slack投稿失敗: ${res.status} ${await res.text()}`);
  }
}

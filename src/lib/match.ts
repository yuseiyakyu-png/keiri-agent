import type { UnmatchedTxn } from "./freee";

export interface MatchingRule {
  keyword: string;
  account_item_name: string;
}

export interface MatchedItem {
  txn: UnmatchedTxn;
  rule: MatchingRule;
}

/**
 * 摘要にルールのkeywordが「完全に含まれている」ものだけを一致とみなす。
 * あいまい一致(部分的な類似度判定など)は絶対に入れないこと — 課題の絶対ルール。
 */
export function matchExact(txns: UnmatchedTxn[], rules: MatchingRule[]): MatchedItem[] {
  const matched: MatchedItem[] = [];
  for (const txn of txns) {
    const rule = rules.find((r) => txn.description.includes(r.keyword));
    if (rule) matched.push({ txn, rule });
  }
  return matched;
}

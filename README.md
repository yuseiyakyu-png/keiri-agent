# 経理AIエージェント MVP

未仕訳のうち、過去のルールと完全一致するものだけを人を介さず仕訳登録し、毎朝9時にSlackへ結果を報告するBot。

対象範囲は「①実績あり(完全一致のみ自動登録)」のみ。②(AI高確信・人の承認)、③(判断不能・人に質問)は今回のスコープ外。

## 構成

- `netlify/functions/daily-run.mts` — 毎朝9:00(JST)にNetlify Scheduled Functionsで自動実行
- `netlify/functions/manual-run.mts` — 動作確認用の手動実行エンドポイント(`?secret=`必須)
- `src/lib/freee.ts` — freee会計APIとの連携(OAuthトークン管理・明細取得・仕訳登録)
- `src/lib/match.ts` — 完全一致のみの照合ロジック(あいまい一致は絶対に入れない)
- `src/lib/slack.ts` — Slackへの結果報告
- `src/lib/run.ts` — 上記をまとめた1回分の処理本体
- `supabase/schema.sql` — ルール表・トークン保存用・実行ログのテーブル定義
- `scripts/oauth-setup.ts` — freeeの初回OAuth認可を行うワンショットスクリプト

## セットアップ手順

1. Supabaseプロジェクトを作成し、SQL Editorで `supabase/schema.sql` を実行する
2. `.env.example` を `.env` にコピーし、値を埋める
3. freeeの初回認可: `npm run oauth-setup` を実行 → 出力されたURLをブラウザで開いて許可 → `code`を控える → `npm run oauth-setup -- <code>` を再実行
   - 事業所一覧が表示されるので、テスト用事業所の `company_id` を `.env` の `FREEE_COMPANY_ID` に設定する
4. `supabase/schema.sql` 末尾のサンプルルールを、実際の摘要に合わせて `matching_rules` テーブルで編集する
5. ローカル確認: `npm run dev` → 別ターミナルで `curl "http://localhost:8888/manual-run?secret=<MANUAL_RUN_SECRET>"`
6. Netlifyにデプロイし、環境変数(.envと同じ項目)をNetlify側の環境変数設定にも登録する
7. Netlify管理画面のFunctionsページで `daily-run` に `Scheduled` バッジが付いていることを確認する
8. 2営業日連続でSlackに自動投稿が届けば完成

## 絶対に守ること

- 本番の会計データには最後まで接続しない(テスト事業所のみ)
- APIキー・トークンは `.env` / Netlifyの環境変数のみで管理し、コードに書かない
- あいまい一致で登録しない(`matchExact` の完全一致ロジックを変更しない)

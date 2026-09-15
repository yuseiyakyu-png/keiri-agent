-- 経理AIエージェント MVP 用のSupabaseスキーマ
-- SupabaseダッシュボードのSQL Editorでそのまま実行してください。

-- 摘要 -> 勘定科目 の対応ルール(完全一致でしか使わない。あいまい一致ロジックはコード側でも入れない)
create table if not exists matching_rules (
  id bigint generated always as identity primary key,
  keyword text not null,             -- 摘要にこの文字列が含まれていたら一致とみなす
  account_item_name text not null,   -- 登録する勘定科目名(freee側の勘定科目名と完全一致させる)
  memo text,                         -- 任意: このルールの説明(人間向け)
  created_at timestamptz not null default now()
);

-- freeeのOAuthトークン保存用(1行だけを使い回す)
-- freeeのrefresh_tokenは使い捨て(ローテーション)のため、更新のたびに上書きが必須
create table if not exists freee_tokens (
  id int primary key default 1,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- 実行ログ(毎朝の結果を記録。つまずきメモ・提出物の裏付けにもなる)
create table if not exists run_logs (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  total_unmatched int,
  registered_count int,
  registered_items jsonb,
  status text,          -- 'success' | 'error'
  error_message text
);

-- まずは自分の手で5件、動作確認用のルールを入れる例(内容は実際の摘要文言に合わせて書き換える)
insert into matching_rules (keyword, account_item_name, memo) values
  ('楽天カード', '通信費', 'サンプルルール1: 実際の摘要に合わせて編集すること'),
  ('Amazon Web Services', '支払手数料', 'サンプルルール2'),
  ('NTT東日本', '通信費', 'サンプルルール3'),
  ('Google Workspace', '通信費', 'サンプルルール4'),
  ('freee株式会社', '支払手数料', 'サンプルルール5')
on conflict do nothing;

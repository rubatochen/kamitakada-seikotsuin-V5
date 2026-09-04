# 上高田整骨院 V5 — Cloudflare 予約システム

GitHub リポジトリを Cloudflare Pages に接続して、無料の D1 データベースで予約を共有する構成です。

## 構成
- `site/` — 既存サイト + 予約ページ + 管理ページ
- `functions/api/` — Cloudflare Pages Functions API
- `schema.sql` — D1 のテーブル作成SQL
- `wrangler.toml.example` — 任意のWrangler設定例

## Cloudflare設定
1. GitHub にこのフォルダの中身を push。
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → GitHub を接続。
3. Build command は `exit 0`、Build output directory は `site`。
4. D1 Database を作成し、Pages プロジェクトの Settings → Bindings → D1 database bindings で **Variable name: `DB`** として接続。
5. D1 の Console で `schema.sql` を実行。
6. Settings → Variables and Secrets で **`ADMIN_PASSWORD`** を Secret として設定。
7. 再デプロイ。

予約ページは `/reserve.html`、管理画面は `/admin.html` です。

## 注意
- 管理画面URLは秘密にする必要はありません。パスワードで保護します。
- 予約データはD1に保存され、同じ時間枠の二重予約をデータベース側で防止します。
- 無料プランのD1/Workersには利用上限があります。小規模な個人整骨院の予約用途なら通常は十分ですが、Cloudflareの現在の料金・上限を確認してください。

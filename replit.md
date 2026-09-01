# note / はてなブログ自動投稿サーバー

noteとはてなブログの記事を保存し、投稿ジョブを安全に実行する Express API です。

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-server run weekly-publish` — run one weekly generation and publishing cycle (requires production secrets)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run test:save-article` — test the Workers-compatible save API through the shared proxy
- `pnpm --filter @workspace/scripts run test:cloudflare-worker` — test the deployed Cloudflare Worker through to the Replit API
- Required env: `DATABASE_URL` — Postgres connection string

## Weekly publishing with GitHub Actions

- `.github/workflows/weekly-publish.yml` runs every Saturday at 22:00 UTC, which is Sunday 7:00 in Japan.
- The workflow builds and runs a one-shot publisher, so it does not require a continuously running API server.
- Add these GitHub repository Actions secrets: `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`, `HATENA_API_KEY`, `HATENA_BLOG_ID`, `HATENA_USER_ID`, `NOTE_EMAIL`, and `NOTE_PASSWORD`.
- `workflow_dispatch` can be used to run the same job manually from the Actions tab.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API契約の唯一のソース
- `lib/db/src/schema/index.ts` — 記事と投稿ジョブの PostgreSQL スキーマ
- `artifacts/api-server/src/routes/articles.ts` — 記事の保存・更新・削除API
- `artifacts/api-server/src/routes/publish-jobs.ts` — 投稿ジョブのキュー・キャンセルAPI
- `artifacts/api-server/src/routes/save-article.ts` — Workers互換の `/api/saveArticle`
- `artifacts/api-server/src/lib/http.ts` — APIエラーとID検証の共通処理
- `artifacts/api-server/src/lib/api-key.ts` — `/api/saveArticle` のBearer/APIキー検証
- `cloudflare-worker/worker.js` — Cloudflare WorkerからReplit APIへの転送
- `artifacts/api-server/src/publishers/runner.ts` — 投稿ジョブの常駐実行
- `artifacts/api-server/src/publishers/hatena.ts` — はてなブログAtomPub投稿
- `artifacts/api-server/src/publishers/note.ts` — note投稿のPlaywright実行

## Architecture decisions

- 記事と投稿ジョブは別テーブルに分け、記事の状態と実行状態を独立して追跡する。
- 投稿キュー投入と記事状態更新は同一トランザクションで行う。
- キュー投入後の記事は編集・削除できない。投稿の一貫性を守るため、失敗後のみ再編集できる。
- OpenAPI変更後は `pnpm --filter @workspace/api-spec run codegen` を実行する。
- 本番の週次投稿はCloudflare Workerや常駐APIに依存せず、GitHub ActionsのワンショットWorkflowで実行する。

## Product

- note / はてなブログ記事の下書きを保存・一覧・更新・削除できる。
- Workersから `/api/saveArticle` へ `date`・`title`・`body`・Base64画像を送って保存できる。
- 下書きを即時または予約投稿ジョブとしてキューに入れられる。
- キュー済みジョブをキャンセルできる。
- 投稿ジョブはサーバー内で実行し、`target` に応じてnoteまたははてなブログへ投稿する。

## User preferences

-

## Gotchas

- `DATABASE_URL` がない状態では DB パッケージの初期化に失敗する。
- `/api/saveArticle` は `SAVE_ARTICLE_API_KEY` によるBearer/APIキー認証を要求する。Secret未設定時は503を返す。
- `SAVE_ARTICLE_API_KEY` はReplit Secretとして設定する。Cloudflare Worker用の設定は本番運用では不要。

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- 投稿対象はジョブ作成時の `target`（`note` または `hatena`）で指定する。
- はてな投稿には `HATENA_USER_ID`・`HATENA_BLOG_ID`・`HATENA_API_KEY`、note投稿には `NOTE_EMAIL`・`NOTE_PASSWORD` が必要。認証情報はReplit Secretsに保存する。

# オシスマ修理事例自動化｜導入前の確定事項（2026-11-18）

## 現在の結論
GitHub開発ブランチのコードは**実環境未接続**。ユニット／VM結合テスト合格は、本番Apps Script・外部AI API・Cloudflareでの実動作を意味しません。**`main`へのマージやGAS本番デプロイはまだ禁止**。

## 導入対象（この順に本番GASの「コピー」へ）
`build-legacy-bundle.mjs` で7モジュールを組み立てます。対象は
`legacy-ai-runtime.gs`、
`legacy-draft-payload.gs`、
`legacy-import-bridge.gs`、
`legacy-auto-draft-bridge.gs`、
`legacy-safe-sync.gs`、
`legacy-photo-alt.gs`、
`legacy-readonly-preflight.gs`。
これは**実施済みの導入ではなく、追加候補**です。元の `承認.gs`、`共通.gs`、`受け渡し.gs`、`回答の取り込み.gs` はそのまま保存します。

古い試作用 `auto-intake.gs` / `auto-draft.gs` / `sheet-sync.gs` / `owner-preview.gs` は**コピーしない**。現行本番の `apiImport()` と `apiSyncDrafts()` を使い、二重の管理シート行・写真コピーを作らないようにします。

## 画面
`assemble-legacy-review.mjs` を使い、元の `承認画面_表示.html` のコピーから**別ファイルへ**修正版を生成します。現行のログイン確認、写真「公開OK」、記事承認、公開候補書き出し、HP本番公開手順は上書きしません。挿入位置が変わっていたりJavaScript構文に不備があれば生成しません。

## 必須の開始条件
1. **本番保全**：元のApps Scriptファイル、現在のスクリプトプロパティの名前とスイッチ、管理シートの構成、デプロイIDとバージョン、動作中トリガーを確認し、元に戻す手順を用意。
2. **テスト用GAS**：本番スプレッドシートを使わず、架空の報告・架空の写真を利用した管理シートと専用Drive領域を分離。テスト専用の管理Webアプリのみ動かす。
3. **現行権限**：本人確認 `requireApprover_()`、`Session.getActiveUser()`、Sheets拡張サービス、Drive v3拡張サービスを確認。時間トリガーで本人確認が取れなければ**止める**。無断の認証バイパスは行わない。
4. **自動スイッチ**：`OSH_LEGACY_AUTO_IMPORT_ENABLED`、`OSH_LEGACY_AUTO_DRAFT_ENABLED`、`OSH_LEGACY_SYNC_ENABLED` はすべて初期 `false`。古い案件の報告ID（Galaxy、iPad）は保留。新規フォーム処理開始行は導入時点の最終行+1を設定。
5. **外部AI**：`AI_DATA_SHARING_APPROVED` は初期 `false`。まずAPI通信なしの模擬JSONでテスト。利用者が送信対象と従量料金を確認し、明確に同意するまで `ANTHROPIC_API_KEY` などの設定や外部送信を有効にしない。APIキーはGitHubやHTMLに保存しない。
6. **Google投稿**：Business Profile API審査が終わるまでGoogle最新情報・Google写真一覧を自動投稿しない。既存データ形式の都合で `drafts.gbp` は作るが、記事公開後も自動投稿はしない。
7. **Cloudflareプレビュー**：実際の承認済み写真・記事のみで作業ブランチを作成し、公開URLのアクセス範囲、検索除外、画像のプライバシーを確認した上でオーナーへプレビュー提示。**明確な承認まではmainにマージしない**。

## テストが満たすべき条件
- フォーム回答の取り込みで重複を作らず、途中失敗でもカーソルを進めない。
- 画像の個人情報はAIで自動公開OKにしない。オーナー目視確認が必須。
- 修理未完了の報告は記事として公開しない。AI出力をそのまま事実として扱わない。
- 承認後の文章・写真・画像加工の変更は指紋を再確認し、再承認なしでは公開しない。
- 既存のHPに触れずにテストでき、失敗時は即時OFFと元のソースへ戻せる。

## 現時点で残る外部作業
ChatGPTから接続されているGitHubツールではブランチのコード作成とテストまで可能ですが、**Google Apps Scriptエディタ/APIへプロジェクトを作成・更新する接続はありません**。Apps Scriptのコピーを実際に作る操作、GAS OAuth承認、API費用承認、テスト用Cloudflareデプロイ確認は別工程です。これらを完了したとは扱いません。

**公開時の役割分担**：スタッフがフォーム報告→AI下書き→オーナーがスマホで修理記事と写真を確認・承認→Cloudflare完成プレビューをオーナーが確認→オーナーの明確な公開承認→GitHubレビュー・マージ→本番確認。

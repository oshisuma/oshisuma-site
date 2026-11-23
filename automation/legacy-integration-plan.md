# 既存Apps Scriptへの統合方針（2026-11-18）
作業用資料。実システムにはまだ導入・有効化していません。

## 照合した本番GAS
ユーザーが現行エディタから共有した「承認.gs」「共通.gs」「受け渡し.gs」。

- 共通.gs: 管理シートは `SpreadsheetApp.getActiveSpreadsheet()`、`TAB_DRAFTS / TAB_LEDGER / TAB_LOG`、承認者は `requireApprover_()`。フォーム回答への書き込みを許可しない。
- 承認.gs: `apiResponses()` で既存の回答一覧、`apiImport(key)` で元の報告キーを使い、写真コピーと管理行・ログの作成を行う。既存管理行への下書き適用は `apiSyncDrafts()` → `loadDraft_()` → `applyDraft_()`。承認・公開候補は `apiApprove()` だが本番デプロイはしない。
- 受け渡し.gs: `exchangeFolders_()` は Script Properties `EXCHANGE_IDS` で intake / photos / drafts / approved の各IDを管理する。Drive.Files（拡張サービス）で必要なファイルを管理し、元写真を読み取る。 `readDraftFiles_()` は drafts フォルダを列挙して最新の下書きを選ぶ。

## 設計を変更する理由
試験で作った `auto-intake.gs` は新しい報告キー・ID・独立した管理行を作ろうとするため、既存 `apiImport()` と同時運用すると二重処理になる。 `sheet-sync.gs` も既存 `apiSyncDrafts()` の代わりに新しい行を追加してしまう。

**両ファイルは本番GASへの直接統合対象から外す。** 現在の作業ブランチには互換性ガードを追加済み。削除ではなく比較・試験用に保持する。

## 採用する構成
1. **回答取り込み**：既存 `apiResponses()` / `apiImport(key)` を再利用。新設 `legacy-import-bridge.gs` が新規回答のみを選び、本人確認・重複検出・既存ロック・写真コピーを保持する。初期スイッチはOFF。時間トリガーで本人メールが空なら安全停止するため、実行主体と認証方式を必ず先にテストする。
2. **AI下書き**：既存報告から必要最小限の文章データだけ抽出。AI送信の同意・課金設定なしでは実行しない。写真や顧客識別情報を送らない。Google Drive の既存 drafts に、`applyDraft_()` が受け付ける**差分形式** `{ reportId, facts, media, drafts }` を出力する。現在の `auto-draft.gs` は実機形式と未統合で、この接続は未実装。
3. **下書き反映**：`apiSyncDrafts()` / `loadDraft_()` による既存管理行の改版処理を使う。別処理から `下書き` に `appendRow` しない。
4. **画面**：既存 `承認画面_表示.html` を活かす。記事・画像の公開可否・Google文章を閲覧できる**制作プレビュー**を本番公開前に提供し、最終承認は別操作。ユーザーの要求どおりプレビュー後の明示承認を必須にする。
5. **公開**：承認の指紋、Cloudflareの作業ブランチプレビュー、本人確認と最終公開許可を検証後にHPを更新。GoogleビジネスプロフィールはAPI承認後に別経路で送信。

## セキュリティ・データ保存
- 既存GASは `spreadsheets.currentonly`, `spreadsheets.readonly`, `drive.file`, `drive.readonly` などの限定的スコープ。追加関数が要求する権限を確認し、無断で強いスコープに変更しない。
- `exchangeFolders_()` の EXCHANGE_IDS を再利用する。同名フォルダを新しく作成しない。
- `Session.getActiveUser().getEmail()` が取得できない時間トリガーの場合は処理を進めず、認証設計を再検討。
- 2026-11-17の Galaxy S23 Ultra と iPad A16 は、既存報告として公開保留。テスト用の事実は変更しない。
- 本番GASのスクリプトに変更する前に、エディタの現行ソース・デプロイ・スクリプトプロパティをバックアップし、差分と戻し方を確認する。
- 本番公開、AI APIへの実リクエスト、管理シートへの実書き込みは未実行。

## 次に確認するファイル
- `回答の取り込み.gs`：`buildCaseReport_()`、`reportKey_()`、写真のID・フィールド形式。自動化が既存レコードを再利用できるか確定。
- `承認画面_表示.html`：安全なプレビュー・修正・明示承認の画面統合。
- `appsscript.json`：必要なスコープ・拡張サービス。秘密のスクリプトプロパティ値は収集しない。

作業ブランチ `work/auto-case-pipeline-phase1-20261117` の追加モジュールは導入せずOFFのまま開発する。

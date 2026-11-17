# 修理事例：自動下書き（第1段階・試験実装）

## 目的
スタッフが送信した修理報告をAIが検知して、HPとGoogleビジネスプロフィール用の**文章下書き**を自動作成し、オーナーへ確認メールを送る。公開・投稿は今までどおり必ずオーナーの承認後。

## 今回追加したもの
`automation/auto-draft.gs`：Google Apps Script へ統合するための新規モジュール（**本番未導入・実行OFF**）。

1. 既存のDrive「オシスマ_修理事例_受け渡し/intake」の新しいJSONを探す。
2. AIで文章の下書き（HP記事用・Google用）を生成。修理結果が明確でない場合は公開保留。
3. 下書きを既存のDrive `drafts` フォルダに保存する。既存データは上書きしない。
4. オーナーへ確認メールを送信する。
5. 写真のプライバシー審査、画質補正、修理内容との一致確認は**未実装**で、各写真は `pending` を維持する。承認済みの状態にはしない。
6. Web公開、GitHub `main` への反映、Google投稿の実行機能は含まない。

## 既存機能と接続する際の注意
- 現在のフォーム受付から`intake`への自動取込は未接続。既存Apps Scriptの「最近の回答を取り込む」機能との結合が必要。
- このモジュールが作るJSONを**管理シート「下書き」タブと承認画面へ読み込む連携も未接続**。これができるまでは完成通知とは呼ばない。
- 既存のHPプレビュー生成・写真処理・二段階の承認フローは保持する。公開セットに含める写真が安全・画質検証済みであることを確認してからプレビューを生成する。
- iPad A16（R-20261117-83fc7631）とGalaxy S23 Ultra（R-20261117-f5586927）は**テスト対象・公開保留**。導入前のデータを一斉に再処理しない。
- 新しいGASプロジェクトを作るのでなく、既存の管理用Apps Scriptの関数との重複を確認して慎重に統合する。

## 必須のスクリプトプロパティ（統合してから）
`HANDOFF_FOLDER_ID`, `OWNER_EMAIL`, `APPROVAL_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AUTO_START_AFTER`（ISO日時）、`HOLD_REPORT_IDS`（2件を明示保留）、
`MAX_AI_CALLS_PER_DAY`（初期3回）、`AI_DATA_SHARING_APPROVED`（初期**false**）。`AUTO_DRAFT_ENABLED`は初期**false**。APIキーなどの秘密をGitHubへ保存しない。

**重要**：この試験コードは外部AIの認証ヘッダーを `x-api-key` / `anthropic-version: 2023-06-01` として構成していますが、実際のモデル名・契約・権限は未確認です。氏名・住所などは簡易除去だけでは完全に隠せません。個人情報を含む原文の外部送信は、運用方針の承認前に有効化してはいけません。\n\n**重要**：Claude Codeの利用料金とは別に、API契約・従量料金が発生し得ます。報告文をAIプロバイダーへ送るため、プライバシー・費用・モデル設定についてオーナーが承認するまで有効化しないでください。

## 動作確認の予定
1. 合成テストデータでDrive内の新規取込・二重登録防止・失敗時の停止を検証。
2. AI APIの認証・課金上限とリクエスト形式をテスト環境で検証。
3. 写真のプライバシー保護・品質補正を実ファイルで検証。識別できるQRコード等が残るなら公開しない。
4. 管理シート→スマホ/PC承認画面への自動反映とメールリンクを検証。
5. 未承認の状態でHP/Googleが一切変更されないことを確認。
6. GitHubの作業用ブランチ→Cloudflareプレビューを確認し、ユーザー承認後のみ本番接続。

**この変更だけでは完全自動化はまだ完了していません。オーナーの本番公開承認は求めず、作業用PRのレビューだけ行います。**

## 実行可能なテスト（2026-11-17）

`node --test automation/auto-draft.test.mjs` を使用します。GitHub Actions の `Repair case automation checks` でも実行。

- 実行停止（既定OFF）
- データ送信未承認時の停止
- Galaxy S23 Ultra・iPad A16 の恒久的保留
- 下書きが二重作成・二重通知されないこと／認証ヘッダー形式
- 未完了は記事化せず保留
- メール・電話・URLの簡易マスク

実行例・結果：[GitHub Actions 成功](https://github.com/oshisuma/oshisuma-site/actions/runs/44090470437)

注意：実際の写真処理、Googleフォーム→intake自動取込、管理シートへの書戻し、APIへの実通信、Cloudflareプレビュー、最終承認は未検証です。検証が終わるまで `main` へ統合しないでください。

## 第2段階：フォーム取り込み・管理シート同期（2026-11-17追加）

- `auto-intake.gs`: 実際のフォーム回答シートの先頭7列を照合し、**未取り込み行だけ**画像コピー付きで受け渡しフォルダへ書き出す。列名の不一致・日時解釈失敗・画像欠落時は停止。回答の重複取り込みを防ぐため管理シート「取り込み済み」の行番号も照合。初期 `AUTO_INTAKE_ENABLED=false`。
- `auto-draft.gs`: 上記 intake からAI文章下書きを生成するが、**外部AIへのデータ送信同意・APIキー・日次件数上限**がすべて満たされるまで停止。初期 `AUTO_DRAFT_ENABLED=false`。
- `sheet-sync.gs`: Drive drafts の新しい未承認下書きを管理シート「下書き」へ追記する。**既存の承認済み行を更新しない**。初期 `AUTO_DRAFT_SHEET_SYNC_ENABLED=false`。
- `oshAutoPipelineTick()`: 上記3つを順に呼ぶ候補関数。**GASに統合するまではトリガー未設定**。

### 接続設定が必要なもの
`SOURCE_SPREADSHEET_ID`、`MANAGEMENT_SPREADSHEET_ID`、`HANDOFF_FOLDER_ID`、`AUTO_INTAKE_MIN_ROW`（新規回答のみを対象にする開始行）、
`HOLD_REPORT_IDS`（GalaxyとiPadの既存2件を公開保留）、`AI_DATA_SHARING_APPROVED`、
`AUTO_DRAFT_ENABLED`、`AUTO_DRAFT_SHEET_SYNC_ENABLED`、`AUTO_INTAKE_ENABLED`。

GASの初期化・権限・トリガーの設定と本番導入は未実行。フォームと管理用の既存Apps Scriptを照合して統合してから、順番に機能を有効化する。

**注意**：この段階では公開用画像の個人情報ぼかし・画質補正はまだ接続しておらず、写真の判定値は必ず `pending`。AIの文章内容・写真安全性は未検証で、下書き生成は**公開や承認を意味しない**。実際のCloudflareプレビューとGoogleのAPI投稿も未接続。

### CI
`node --test automation/*.test.mjs`（GitHub Actionsで3ファイルをテスト）。

# スマホ本人限定プレビュー：導入ゲート（2026-11-18）

## 結果
- 合成テスト用「確認済み」記録は Google Sheets に**実保存済み**：報告ID `R-20261118-demo0001`、版 `2`、`sandboxReview.state=confirmed`、本番承認は `draft`、公開記録なし。
- スマホプレビューのコード：`automation/sandbox-mobile-readonly.gs`
- モックテスト：`automation/sandbox-mobile-readonly.test.mjs`
- **本番 Apps Script への導入・スマホ Web アプリのデプロイは未実施。**

## 必要な修正を終えた理由
コンテナバインドGASの `SpreadsheetApp.getActiveSpreadsheet()` に頼った旧試作は、ウェブアプリでスプレッドシートを特定できない場合があるため、スマホ用だけを **Sheets Advanced Service v4 の読取API** に分離した。

外部ユーザーがアクセスできるようにしてはいけない。読み取りAPI自体にはユーザーアクセスを認可する仕組みが別に必要で、本文の非公開と本人確認を実機で確認する。

## 事前準備（まだ実行しない）
1. テスト用Apps Scriptの **現行 `appsscript.json` を保存・バックアップ**。
2. `sandbox-mobile-readonly.gs` を新規ファイルとして追加。元の承認画面・他の本番機能は変更しない。
3. **サービス +** から Google Sheets API (v4) を追加（サービス名 `Sheets`）。
4. 明示 `oauthScopes` に `https://www.googleapis.com/auth/spreadsheets.readonly` を追加。これまでの `spreadsheets.currentonly` / `script.container.ui` は維持。
5. スクリプトプロパティ `OSH_SANDBOX_OWNER_EMAIL` は本人のみが登録する。GitHubやログへメールアドレス・秘密を貼らない。
6. `oshSandboxMobileRead` を **テスト用の本人アカウントで一度実行してから** Webアプリへのアクセス経路を検討する。

## Webアプリにする場合の追加ゲート
- 権限と実行主体（`実行ユーザー` と `アクセスできるユーザー`）をプレビューで確認し、**アクセスできるユーザーは「自分のみ」**。
- `Session.getActiveUser().getEmail()` が空欄の場合は**拒否のまま**。認証を弱めたり、`getEffectiveUser()` へ自動フォールバックしたりしない。
- ログインしていないアクセス・別アカウントでの記事表示不可を検証。**個人情報・写真は未投入**。
- `/exec` のURLは第三者へ渡さず、将来の本番Webアプリと混同しない。
- `doGet` はテスト用スクリプトのみに追加。本番管理GASの既存 `doGet` を置換しない。
- スマホ画面は **表示専用**。「確認済み」「差戻し」は既存テストGASのモーダル経路だけで記録される。

## 注意
- Google Sheets API を有効にしても、このモジュールは **書き込みしない**。ただし権限画面の追加許可は本人が判断する。
- 現段階でAI文章生成、写真へのぼかし、プレビュー承認、本番HP公開、Google投稿は行わない。
- 既存GitHub PR #14はDraftのまま維持し、本番統合・マージの許可とはしない。

## 導入停止条件
- 本人メールが取得できない
- 別のシートID / タイトル / 列見出し / 複数下書き
- 正式承認・公開済み・写真付き・本番フォームのレコードを検出
- 読取権限が不十分、または必要以上の OAuth 権限を求める
- アクセス設定に「全員」「リンクを知っている全員」が現れた

以上の場合はそのまま停止。公開範囲を広げて回避しない。

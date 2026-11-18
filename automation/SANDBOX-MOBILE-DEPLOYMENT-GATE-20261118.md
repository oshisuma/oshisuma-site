# スマホ本人限定プレビュー：導入ゲート（2026-11-18・改訂）

## 現状
- 合成テスト用シートでは報告ID `R-20261118-demo0001` を版2で「確認済み（合成テスト）」として実際に保存できた。**本番承認はdraft、公開記録なし**。
- スマホコードは `automation/sandbox-mobile-readonly.gs`、テストは `automation/sandbox-mobile-readonly.test.mjs`。
- **スマホからの実機アクセス、Webアプリのデプロイ、実顧客データ連携は未実施**。
- GitHubの作業用ブランチのみ。本番の既存スクリプトやHPは変更しない。

## 設計変更
以前の試作は「Google Sheets API v4 + `spreadsheets.readonly`」を要求し、OAuth同意画面で **すべてのGoogleスプレッドシートを参照** する広い権限が表示された。ユーザーに許可せずキャンセルしてもらう方針へ変更。

**現在の採用方式：合成プレビューのスナップショットのみ**
1. 既存のテスト用GASエディタで、検証済みの `oshSandboxReviewReadContext_()` と `oshSandboxReviewRead()` を呼び、架空・確認済み・写真なし・未公開を厳格に検証する。
2. `oshSandboxMobileCaptureSnapshot()` は必要最小限の表示データだけを `PropertiesService.getScriptProperties()` に保存する（架空の記事、個人情報なし）。
3. Web側の `oshSandboxMobileRead()` は本人を `Session.getActiveUser().getEmail()` と専用プロパティで照合し、保存済みの合成スナップショットを読む。SheetやDriveへのリクエストなし。
4. `doGet()` は不一致・エラー時にアクセス拒否ページを出す。成功時の画面にも公開・承認・差戻しボタンなし。
5. スナップショットの期限は7日。期限切れ後は表示不可で再作成が必要。

## テスト用Apps Scriptのマニフェスト
```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/script.container.ui",
    "https://www.googleapis.com/auth/userinfo.email"
  ]
}
```
Google Sheets API v4の**拡張サービスは不要**。追加したサービスは削除してよい（この合成テスト用GASに限る）。`spreadsheets.readonly` を残してOAuth許可を求めない。

## 実装・実機検証の順番
1. OAuth同意画面で「キャンセル」。**広い権限を許可しない**。
2. テスト用 `appsscript.json` のバックアップを確認し、上記の3スコープ構成に戻す。
3. 既存 `スマホ閲覧テスト.gs` の内容を **更新されたGitHubファイル全文** へ置き換える。**同名の doGet を2つ作らない**。
4. 本番GASとは異なる、合成テストだけのファイルで `oshSandboxMobileCaptureSnapshot()` を手動実行し、合成確認済みプレビューの保存成功ログを確認。
5. `oshSandboxMobileRead()` の読み取りのみを検証。OAuthに不審な権限が出たら停止。
6. Webアプリデプロイに進む際は、公開範囲を **「自分のみ」** に制限し、実行主体は **「アクセスしているユーザー」** で本人ログインが取得できるか事前確認。`execute as me` では本人メールが空になる場合があり、その際はアクセスを広げるのでなく停止。
7. スマホの本人アカウントで記事が見られるか、別アカウントやログアウトで拒否されるか、写真・個人情報が含まれないかを検証。

## 停止条件
- ユーザーの本人確認メールが取得できない
- Googleが「すべてのスプレッドシート」等の広い権限を要求
- 実際のフォーム・本番記事・写真を読み込む必要が出た
- Webアプリの共有範囲が「全員」や「リンクを知っている全員」になる
- プレビュー自体のGoogleアカウント本人確認が不完全

この段階で **AI APIの顧客データ送信、写真処理、Cloudflareプレビュー、本番HP公開、Google投稿は行わない**。

`main` マージ、追加課金、個人情報送信、サイト公開には必ず別のオーナー承認が必要。

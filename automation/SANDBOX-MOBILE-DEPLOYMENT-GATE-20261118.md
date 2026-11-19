# スマホ本人限定プレビュー：導入ゲート（2026-11-18・改訂）

## 現状（2026-11-19 実機テスト更新）
- テスト用シートの架空iPhone報告ID `R-20261118-demo0001`、版2は「確認済み（合成テスト）」として保存済み。正式なHP/Googleの承認状態はdraft、公開記録なし。
- **本人の実機検証済み**：Google Apps Scriptのテスト用ウェブアプリを「自分として実行」「アクセスできるユーザー：自分のみ」でデプロイ。バージョン3（2026-11-19 16:01）への更新を画面で確認。Microsoft EdgeでオシスマのGoogleアカウントにログインし、スマホ閲覧に成功。
- **架空iPhone記事**：スマホで「確認済み」をテスト専用Script Propertiesに記録。画面を再読み込みしても確認済みが維持され、操作ボタン無効化を実機で確認。
- **別の架空iPad記事**：`/exec?mode=return` で「小美玉市のiPad 第9世代 充電口修理事例（架空）」を表示。スマホで差し戻し理由「修理内容をもう少し具体的に説明してください。」を保存し、画面更新後も同じ理由が表示されることを本人から確認。
- 記録は `OSH_SANDBOX_MOBILE_ACTION_V1` と `OSH_SANDBOX_MOBILE_RETURN_V1` の別キーに分離。既存の実顧客データ、本番GAS、本番HP、Google投稿、外部AI、課金処理へ未接続。
- 本人以外のアカウントによる**アクセス拒否の実機試験は未実施**（コード上の本人照合とGoogleの「自分のみ」設定は確認済み）。実顧客データを使う前に別途確認。
- GitHub PR #14はドラフト、未マージ。前述はWebアプリの合成テストを示すもので、スタッフ報告→AI下書き→HPの本番連携を検証したものではない。

## 次の段階：スタッフ報告→下書き（未接続）
1. 既存の実フォーム・本番管理シート・既存GASはまず**読取専用で現状確認**。Google API/OAuthの新規広域権限は認めない。既存の実顧客データをコピーしてテストしない。
2. `legacy-import-bridge.gs` と `legacy-auto-draft-bridge.gs`、`legacy-safe-sync.gs` は初期OFFのまま、架空のフォーム・写真と模擬AIレスポンスを使い既存 `apiImport`/`apiSyncDrafts` との整合性を確認。旧 `auto-intake.gs` 等を同時使用しない。
3. 外部AIへの顧客情報送信と従量料金はオーナーから明確な承認を得るまで禁止。写真に識別情報を含む場合は安全な非公開処理ができるまで公開しない。
4. 実運用前にバックアップ、作業用デプロイ、停止スイッチ、差し戻しから再編集する経路を検証する。HPは「プレビュー→オーナーの明確な承認→公開」を守る。

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

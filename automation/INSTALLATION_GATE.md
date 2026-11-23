# オシスマ修理事例：実接続の安全手順

状態：開発ブランチで検証済み。本番Apps Script・HPは未変更。

## 目的
スタッフ報告 → AI記事下書き → オーナーの写真確認・修正 → HP記事承認 → Cloudflare完成プレビュー → オーナー最終承認 → GitHubレビュー/本番公開。
Googleビジネスプロフィールへの投稿はAPI審査が終わるまで実施しない。

## 接続候補
- GAS 7ファイル：legacy-ai-runtime.gs、legacy-draft-payload.gs、legacy-import-bridge.gs、legacy-auto-draft-bridge.gs、legacy-safe-sync.gs、legacy-readonly-preflight.gs、legacy-photo-alt.gs
- 旧試作のauto-draft.gs / auto-intake.gs / sheet-sync.gsを同時導入しない（二重登録を防ぐ）。
- verify-legacy-bundle.mjs でGAS共存・初期OFFを検証する。構文確認はApps Script実機確認の代わりではない。
- assemble-legacy-review.mjs で承認画面を別ファイルとして組み立てる。既存HTMLを上書きしない。

## 接続前の必須確認
1. 本番GASの現在のコード・トリガー・プロパティ・デプロイ版をバックアップし、復旧方法を確保する。
2. テスト用GASと専用の合成データ入り管理シートを作る。本番管理シートを丸ごと複製して顧客情報を持ち込まない。
3. テスト用のDrive受け渡しフォルダも独立させる。顧客の実画像やIDをGitHub Actionsへ送信しない。
4. 所有者の本人認証がWebアプリと時間トリガーで通るか検査。認証できなければ止め、回避しない。
5. Google APIサービス、OAuth権限、写真コピー処理は、テスト環境の合成報告だけで確認する。
6. AI外部送信・有料API・キー登録はユーザーの明確な承認が出るまでOFFにする。
7. Cloudflareの完成プレビューをオーナーに提示。承認前のmainマージと本番公開はしない。

## 初期設定（すべてOFF）
- OSH_LEGACY_AUTO_IMPORT_ENABLED=false
- OSH_LEGACY_AUTO_DRAFT_ENABLED=false
- OSH_LEGACY_SYNC_ENABLED=false
- AI_DATA_SHARING_APPROVED=false
- MAX_AI_CALLS_PER_DAY=1（利用を許可された場合の初期値）
- OSH_LEGACY_AUTO_START_ROW=テスト用のフォーム回答最終行+1
- OSH_LEGACY_IMPORT_CURSOR=開始行と同値
- OSH_LEGACY_AI_START_AFTER=テスト開始日時以降のISO8601
- OSH_LEGACY_SYNC_START_AFTER=テスト開始日時以降のISO8601

## 順次テストする
1. 本人限定の読み取り専用診断を実行し、設定不足や保存先の不整合を確認。
2. AIなしで架空報告を1件だけ取り込み、重複取り込みと0枚写真で止まることを検証。
3. 合成AI下書きを1件だけ読み込み、管理画面の表示を確認。
4. 写真未確認でのHP承認拒否、写真公開OK、alt編集、古い版からの変更拒否を確認。
5. HP公開候補からCloudflare作業プレビューまで確認。本番公開はしない。
6. 外部AIの通信は別途承認後。課金上限・個人情報の扱いを確認してから。

## 失敗時の復旧
自動化スイッチをすべてOFF、時間トリガー停止、API通信停止。テストデータは隔離保管し、本番GASのコード・デプロイ・設定が以前の状態であることを検証。自動取り込みは途中失敗後に連打して再試行しない。

## 現時点の制限
GitHubのテスト成功はGAS実機接続の成功を保証しない。現在利用可能な接続ツールではGASプロジェクト自体を作成・編集・デプロイできないため、実環境への最終接続にはユーザーの最小限の画面操作が必要。

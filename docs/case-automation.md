# 修理報告から、HP修理事例とGoogle最新情報の下書きを作るしくみ（段階①）

1回の修理報告を「報告データ」1ファイルにまとめ、そこから媒体ごとの下書きを作る。
公開済みの修理事例（`/repair/cases/`）のデザイン・文章・写真・URLは変更しない。

```
フォーム・写真登録Webアプリの報告
  └→ 報告データ content/case-reports/…/<reportId>.json
        facts   … 報告に書かれた事実だけ（全媒体で共通）
        media   … 写真（全媒体で共通。alt・個人情報チェック・報告との一致確認）
        drafts  … 媒体ごとの下書き
          hp    … HP記事・一覧カード
          gbp   … Googleビジネスプロフィールの最新情報
          （将来 instagram / note / ameblo を同じ形で追加）
        publishLog … 媒体ごとの公開記録（二重投稿を防ぐ）
```

## ファイル

| 場所 | 役割 |
|---|---|
| `content/case-reports/` | 報告データ（1件＝1ファイル）。`test/` は架空のテストデータ |
| `tools/cases/lib.mjs` | 共通処理（記事・カード・Google投稿の作成、確認） |
| `tools/cases/build.mjs` | 確認用ページを作る。`--check` で確認だけ |
| `tools/cases/test.mjs` | テスト |
| `repair/cases/_preview/` | 確認用ページ（自動生成・noindex・どこからもリンクしない） |

記事ページの外枠（ヘッダー・お問い合わせ・店舗情報・フッター・CSS）は、公開済みの記事
`repair/cases/2026-11-13-mito-iphone13pro-screen-battery/index.html` をそのまま読み込んで使う。
外枠を二重に持たないため、公開済みページのデザインを直せば、新しい記事にも同じ変更が反映される。

## 報告データの項目

| 項目 | 内容 |
|---|---|
| `reportId` | 報告ID。同じIDは二度登録できない |
| `status` | `test`（架空）/ `draft` / `review` / `approved` / `published` |
| `facts.area` | お客様の地域（市町村）。不明なら `null`。店舗所在地で埋めない |
| `facts.device` | 機種 |
| `facts.consultation` / `works` / `result` | ご相談・対応内容・結果（報告に書かれたものだけ） |
| `facts.uncertain` | 報告から判断できず、人の確認が必要な点 |
| `media[]` | 写真。`src`・`width`・`height`・`alt`・`caption`・`privacyCheck`（個人情報）・`contentMatch`（報告との一致） |
| `drafts.hp` | 記事のURL（`slug`）・掲載日・タイトル（地域・機種・修理内容）・説明文・一覧の要約・本文 |
| `drafts.gbp` | Google投稿の本文（`summary`）と写真。「詳細」ボタンのリンク先は記事URLから自動で付ける |
| `publishLog` | 媒体ごとの公開記録 |

## 自動チェック（エラーがあれば下書きを作らない）

- タイトルの機種・地域・修理内容が、報告（`facts`）と一致しているか
- 報告と違う市町村名が本文に書かれていないか（店舗所在地の茨城町は可）
- 料金、年代・年齢・性別が書かれていないか
- Google投稿の本文に電話番号・URLがないか、1500文字以内か
- 写真のファイルがあるか、`width`・`height` が実物と同じか、`alt` があるか
- `approved` / `published` では、全写真の個人情報チェックと報告との一致確認が `ok` か
- 報告ID・記事URLの重複、公開済み記事と同じURL（上書き）がないか

## 段階と今後

1. **段階①（このブランチ）**：共通の報告データ、記事・カード・Google投稿の下書き作成、確認用ページ、テスト
2. 段階②：写真の自動処理（SEO向けファイル名、alt、圧縮、WebP、一覧用サムネイル、撮影情報の削除、個人情報チェック）
3. 段階③：Apps Script から報告データを作成（既存のフォーム・通知用GASは変更しない）
4. 段階④：スマホでの承認、一覧ページ・サイトマップへの追加、PR作成
5. 段階⑤：Googleビジネスプロフィールへの投稿（承認後のみ）

本番公開・`main` への統合・Google投稿は、オーナーの明確な承認の後にだけ行う。

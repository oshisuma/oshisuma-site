# 修理・対応事例ページの仕組み

## 構成

| 場所 | 役割 | 編集 |
|---|---|---|
| `content/cases/<slug>.json` | 事例1件分のデータ（1ファイル＝1記事） | ここだけを追加・編集する |
| `content/cases/_categories.json` | 分類（iPhone修理・データ移行など）の一覧 | 分類を増やすときだけ |
| `content/cases/_template.json` | 記事データの見本（ページにはならない） | — |
| `tools/build-cases.mjs` | データからページを作るプログラム | — |
| `cases/cases.css` | 事例ページ共通のデザイン | デザイン変更時 |
| `cases/index.html`、`cases/<slug>/index.html` | 一覧ページ・個別記事（自動生成） | 手で編集しない |
| `index.html` の `cases:auto:start`〜`end` | トップの「最新の修理事例」3件（自動生成） | 手で編集しない |
| `sitemap.xml` | サイトマップ（自動生成） | 手で編集しない |

## 記事を追加する手順

1. `content/cases/_template.json` をコピーし、`<slug>.json` という名前で `content/cases/` に置く。
2. 写真を `optimized/uploads/` に置き、`photos` に書く。
3. `node tools/build-cases.mjs` を実行する（一覧・記事・トップの最新3件・サイトマップが更新される）。
4. 新しいブランチで PR を作り、Cloudflare のプレビューで確認 → 承認・マージで本番公開。

`node tools/build-cases.mjs --check` で、データと生成済みページが一致しているかを確かめられる（書き換えはしない）。

## 項目

| 項目 | 必須 | 内容 |
|---|---|---|
| `slug` | ○ | URL になる名前。`YYYYMMDD-機種-作業-地域` を半角英小文字とハイフンで（例 `20261101-iphone-screen-mito`）。ファイル名と同じにする |
| `status` | ○ | `published`（公開）／ `draft`（下書き。ページを作らない） |
| `indexable` |  | `false` にすると検索結果に出さない（noindex・サイトマップ対象外）。内容が少ないうちは `false` |
| `date` | ○ | 掲載日 `YYYY-MM-DD`。新しい順に並ぶ |
| `updated` |  | 内容を更新した日 |
| `seq` |  | 同じ日付の記事の並び順（大きいほど先） |
| `category` | ○ | `_categories.json` の key（`iphone` `android` `ipad` `switch` `other-repair` `consult` `data-transfer` `used`） |
| `area` | ○ | 市町村名（例 `水戸市`）。番地や町名より細かくしない |
| `device` | ○ | 端末の種類（`iPhone` `Android` `Nintendo Switch` など） |
| `model` |  | 機種名（例 `iPhone 13`）。分かるときだけ |
| `work` | ○ | 対応内容の短い名前（例 `画面交換`） |
| `symptom` |  | 症状の短い説明（タイトルに入る） |
| `summary` | ○ | 一覧・トップのカードに出す1〜2文 |
| `consultation` `diagnosis` `treatment` `result` |  | ご相談内容／診断・ご説明／対応内容／結果。改行で段落を分ける |
| `episode` |  | お客様のエピソード。報告にあり、掲載の同意があるときだけ |
| `staffComment` |  | スタッフのひとこと |
| `photos` | ○ | 1枚目がメイン写真。`alt` は写真の内容を具体的に |
| `title` `description` |  | 空なら自動で作る（`【地域】機種 作業｜症状の修理事例｜店名`） |
| `source` | ○ | 元になった報告（`type`: `google-form` / `existing-site` / `staff`、`ref`、`note`） |

## 守ること（自動作成でも同じ）

- **事実だけを書く。** 報告にない機種名・診断・作業時間・お客様の言葉を補ったり作ったりしない。分からない項目は空のままにする（空の項目はページに表示されない）。
- **料金は書かない。** 「円」「¥」「税込」などが入っているとページ作成が止まる。
- **個人情報を載せない。** お客様の名前・顔・画面に写った個人情報・細かい住所は載せない。写真は掲載の同意があるものだけ。
- **口コミのように見せない。** 星評価やレビュー用の構造化データは事例ページに付けない。
- リポジトリは公開されているため、下書き（`draft`）でも上記を守る。

## 第2段階（Google フォームからの自動作成）につなぐとき

フォームの回答1件を `content/cases/<slug>.json` 1ファイルに変換し、`node tools/build-cases.mjs` を実行して PR を作るだけでよい。マージ（本番公開）は必ず人が行う。

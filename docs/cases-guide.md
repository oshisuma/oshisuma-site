# 修理・対応事例ページの仕組み

## 構成

| 場所 | 役割 | 編集 |
|---|---|---|
| `content/cases/<slug>.json` | 事例1件分のデータ（1ファイル＝1記事）。件数が増えたら `content/cases/2027/` のように年ごとのフォルダに分けてよい | ここだけを追加・編集する |
| `content/cases/_categories.json` | 分類（iPhone修理・データ移行など）。並び順が分類ボタンの順 | 分類を増やすときだけ |
| `content/cases/_template.json` | 記事データのひな形（ページにはならない） | — |
| `tools/build-cases.mjs` | データからページを作るプログラム | — |
| `cases/cases.css` | 事例ページ共通のデザイン | デザイン変更時 |
| `cases/` 以下の `index.html` | 一覧・分類別一覧・記事・確認用ページ（自動生成） | 手で編集しない |
| `index.html` の `cases:cards` `cases:more` `cases:footer` の目印の間 | トップの最新3件・一覧ボタン・フッターのリンク（自動生成） | 手で編集しない |
| `sitemap.xml` | サイトマップ（自動生成） | 手で編集しない |

## できあがるページ

| URL | 内容 | 検索エンジン |
|---|---|---|
| `/cases/`（`/cases/page/2/` …） | 公開中の事例の一覧（24件ずつ） | 検索対象の記事が1件以上あれば対象 |
| `/cases/<分類>/`（例 `/cases/iphone/`） | 分類別の一覧。公開中の事例がある分類だけ作る | 検索対象の記事が3件以上で対象 |
| `/cases/<slug>/` | 公開記事 | 本文が十分な記事だけ対象（下記） |
| `/cases/review/` `/cases/review/<slug>/` | 確認待ち・表示見本の確認用ページ | 対象外（noindex）。どこからもリンクしない |

## 記事の状態（status）と公開の流れ

1. **`draft`**（下書き）… ページを作らない。
2. **`review`**（確認待ち）… `/cases/review/<slug>/` に確認用ページだけを作る。一覧・トップ・サイトマップには出ない。
3. **`published`**（公開）… 店舗の人が事実と写真を確認してから切り替える。次の条件がそろわないとページ作成が止まる。
   - `verification.facts` が `"confirmed"`、`verification.by`（確認した人）、`verification.date`（確認日）がある
   - 写真のうち1枚以上が `check: "ok"`（`"ng"` `"pending"` の写真は事例ページに出ない）
4. `sample`（表示見本）… `review` と同じ扱い。実際の事例ではないことをページ上に表示する。

公開記事は自動で、事例一覧・分類別一覧・関連事例・トップの最新3件・サイトマップに入る。トップの最新3件は、公開記事が3件に満たない間、`legacyTopCard: true` の事例（このしくみ以前からトップに載っていた事例）を元の表示のまま残す。

**検索対象（index）にする条件**：公開記事で、要約以外の本文が150字以上あること。足りない記事は自動で noindex になり、サイトマップにも入らない（実行時に「注意」と表示）。`"indexable": false` で個別に外すこともできる。

## 記事を追加する手順

1. `content/cases/_template.json` をコピーし、`<slug>.json` という名前で `content/cases/` に置く（`slug` は `YYYYMMDD-機種-作業-地域` を半角英小文字とハイフンで。例 `20261101-iphone-screen-mito`）。
2. 写真を `optimized/uploads/` に置き、`photos` に書く。写り込み（下記）を確認して `check` を入れる。
3. `node tools/build-cases.mjs` を実行する。
4. 新しいブランチで PR を作り、Cloudflare のプレビューで確認 → 承認・マージで本番公開。

`node tools/build-cases.mjs --check` で、データと生成済みページが一致しているかを確かめられる（書き換えはしない）。生成時には、ページ内のリンク先がすべて存在するかも確認する。

## 項目

| 項目 | 必須 | 内容 |
|---|---|---|
| `slug` | ○ | URL になる名前。ファイル名と同じにする |
| `status` | ○ | `draft` / `review` / `published` / `sample` |
| `date` | ○ | **掲載日**（ページに載せた日）。新しい順に並ぶ |
| `workDate` |  | **作業日**（実際に修理・対応した日）。確認できたときだけ。掲載日とは別 |
| `updated` |  | 内容を更新した日 |
| `seq` |  | 同じ掲載日の記事の並び順（大きいほど先） |
| `category` | ○ | `_categories.json` の key |
| `area` | ○ | 市町村名（例 `水戸市`）。番地や町名より細かくしない |
| `device` / `model` | ○ / | 端末の種類（`iPhone` など）／機種名（例 `iPhone 13`。確認できたときだけ） |
| `work` | ○ | 対応内容の短い名前（例 `画面交換`） |
| `symptom` |  | 症状の短い説明。20字以内ならタイトルにも入る |
| `summary` | ○ | 記事の冒頭とカードに出す1〜2文の要約 |
| `consultation` `diagnosis` `treatment` `result` `episode` `staffComment` |  | 本文（お困りだったこと／確認したこと・ご説明／対応内容／お渡しまで／エピソード／スタッフより）。空の項目と、要約と同じ内容の項目は表示しない。改行で段落を分ける |
| `headings` |  | 本文の見出しを事例ごとに変えるとき（例 `{"consultation": "電源が突然落ちるようになったiPhone"}`） |
| `body` |  | 見出しと本文を自由に並べたいとき（`[{"heading": "…", "text": "…"}]`）。あると標準項目の代わりに使う |
| `customerComment` |  | お客様の言葉。`{"text": "…", "consent": true}`。掲載の同意がないと作成が止まる |
| `photos` | ○ | 1枚目が記事上部の大きな写真、2枚目以降は下に並ぶ。`check`（`ok` / `ng` / `pending`）と `checkNote` を必ず入れる |
| `verification` | 公開時○ | `facts`（`confirmed` / `unconfirmed`）、`by`、`date`、`note`（確認用ページに表示される未確認事項。改行区切り） |
| `legacyTopCard` |  | 以前からトップに載っている事例の印 |
| `title` `description` |  | 空なら自動で作る（`【地域】機種の作業｜症状｜修理事例｜店名`） |
| `source` | ○ | 元になった報告（`type`: `google-form` / `existing-site` / `staff` / `sample`、`ref`、`note`） |

## 守ること（AI で下書きする場合も同じ）

- **事実だけを書く。** 報告にない機種名・診断・作業日・お客様の気持ちや反応を補ったり作ったりしない。分からない項目は空のままにする（空の項目はページに表示されない）。
- **掲載日と作業日を混同しない。** `date` は掲載日、`workDate` は作業日。
- **料金は書かない。** 「円」「¥」「税込」などが入っているとページ作成が止まる。
- **写真の写り込みを確認する。** お客様の顔・名前、画面に表示された内容、伝票・ラベル・バーコード、QRコード、細かい住所が写っている写真は `check: "ng"`。
- **同じ文章を繰り返さない。** 要約・概要と同じ内容は本文に書かない（書いても自動で省く）。内容が少ない事例は短いままでよい。
- **口コミのように見せない。** 星評価やレビュー用の構造化データは付けない。
- リポジトリは公開されているため、`draft` や `review` でも個人情報は書かない。

## 第2段階（Google フォームからの自動作成）につなぐとき

フォームの回答1件を、上の項目に沿って `content/cases/<slug>.json` 1ファイルに変換する（`status: "review"`、`verification.facts: "unconfirmed"`、写真は `check: "pending"`）。`node tools/build-cases.mjs` を実行して PR を作れば、プレビューの `/cases/review/<slug>/` で内容を確認できる。店舗の人が事実と写真を確認したら `status: "published"` と `verification` を入れて再生成し、PR をマージして本番公開する。マージは必ず人が行う。トップページを手で編集する必要はない。

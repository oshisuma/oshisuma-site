// 修理・対応事例ページを content/cases/ の記事データ（1ファイル＝1記事）から生成する。
//   node tools/build-cases.mjs          … cases/ 以下・トップの事例カード・sitemap.xml を書き出す
//   node tools/build-cases.mjs --check  … 書き出さずに、生成結果がコミット済みのファイルと一致するかだけ確かめる
// 外部パッケージは使わない（Node.js 20 以上）。項目と運用ルールは docs/cases-guide.md。
//
// 記事の status
//   draft      … 何も作らない
//   review     … 確認待ち。/cases/review/<slug>/ に確認用ページ（noindex・どこからもリンクしない）だけを作る
//   sample     … 表示見本。review と同じ扱い
//   published  … 正式公開。verification.facts が "confirmed" で、確認者・確認日があるものだけ
// legacyTopCard: true … このしくみ以前からトップに載っている事例。公開記事が3件に満たない間、トップに元の表示のまま残す

import { readFile, writeFile, readdir, mkdir, rm, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "content", "cases");
const OUT_DIR = path.join(ROOT, "cases");
const CHECK = process.argv.includes("--check");

const SITE = "https://oshisuma.jp";
const STORE = "スマホ・Switch・iPad修理 オシエテスマホ+茨城町本店";
const STORE_SHORT = "オシエテスマホ+茨城町本店";
const LINE_URL = "https://lin.ee/5w0kuAG";
const TEL = "09050145311";
const TEL_LABEL = "090-5014-5311";
const HOURS = "営業時間 10:00〜17:00・月曜定休";
const GA_ID = "G-QMN0B0QSLX";
const OG_FALLBACK = "optimized/og/oshietesumaho-store-exterior-og.jpg";
const ASSET_V = "20261025";
const PER_PAGE = 24;
const MIN_CATEGORY_INDEX = 3; // 分類ページを検索対象にする最低件数
const MIN_BODY_CHARS = 150; // 記事を検索対象にする本文の最低文字数（要約を除く）
const GENERATED = "<!-- このページは tools/build-cases.mjs が content/cases/ から自動生成しています。直接編集しないでください。 -->";
const RESERVED = new Set(["page", "review"]);

const STD_SECTIONS = [
  ["consultation", "お困りだったこと"],
  ["diagnosis", "確認したこと・ご説明"],
  ["treatment", "対応内容"],
  ["result", "お渡しまで"],
  ["episode", "エピソード"],
  ["staffComment", "スタッフより"],
];
const TEXT_FIELDS = ["title", "description", "summary", "symptom", "work", ...STD_SECTIONS.map(([k]) => k)];
const PRICE_RE = /[0-9０-９][0-9０-９,，]*\s*円|[¥￥]|税込|税抜/;

// ---------- 読み込みと検証 ----------

const { categories } = JSON.parse(await readFile(path.join(CONTENT_DIR, "_categories.json"), "utf8"));
const catByKey = new Map(categories.map((c) => [c.key, c]));
const groupLabel = { repair: "修理事例", support: "対応事例" };

const errors = [];
const warnings = [];
const all = [];

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith("_") || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

for (const file of (await walk(CONTENT_DIR)).sort()) {
  const name = path.relative(CONTENT_DIR, file).replaceAll("\\", "/");
  let c;
  try {
    c = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    errors.push(`${name}: JSON として読めません（${e.message}）`);
    continue;
  }
  c._file = name;
  validate(c, path.basename(file));
  all.push(c);
}

function validate(c, base) {
  const err = (m) => errors.push(`${c._file}: ${m}`);
  if (!/^\d{8}(-[a-z0-9]+)+$/.test(c.slug || "")) err("slug は「YYYYMMDD-半角英小文字・数字」の形にしてください（例 20261101-iphone-screen-mito）");
  if (base !== `${c.slug}.json`) err(`ファイル名を ${c.slug}.json にしてください`);
  if (!["draft", "review", "sample", "published"].includes(c.status)) err('status は "draft" "review" "sample" "published" のどれかにしてください');
  for (const k of ["date", "workDate", "updated"]) if (c[k] && !/^\d{4}-\d{2}-\d{2}$/.test(c[k])) err(`${k} は YYYY-MM-DD 形式にしてください`);
  if (!c.date) err("date（掲載日）が空です");
  if (!catByKey.has(c.category)) err(`category「${c.category}」は _categories.json にありません`);
  for (const k of ["area", "device", "work", "summary"]) if (!str(c[k])) err(`${k} が空です`);
  if (!c.source || !str(c.source.type)) err("source.type（元になった報告の種類）が空です");
  for (const k of TEXT_FIELDS) if (PRICE_RE.test(c[k] || "")) err(`${k} に料金の記載があります。事例には料金を掲載しない方針です`);
  for (const s of c.body || []) if (PRICE_RE.test(`${s.heading}${s.text}`)) err("body に料金の記載があります");
  if (c.customerComment) {
    if (!str(c.customerComment.text)) err("customerComment.text が空です");
    if (c.customerComment.consent !== true) err("customerComment は、お客様の掲載同意（consent: true）がある場合だけ載せられます");
    if (PRICE_RE.test(c.customerComment.text || "")) err("customerComment に料金の記載があります");
  }
  if (!Array.isArray(c.photos)) err("photos は配列にしてください（写真なしなら []）");
  for (const p of c.photos || []) {
    if (!str(p.alt)) err(`写真 ${p.src} の alt（写真の説明）が空です`);
    if (!(p.width > 0 && p.height > 0)) err(`写真 ${p.src} の width / height を入れてください`);
    if (!["ok", "ng", "pending"].includes(p.check)) err(`写真 ${p.src} の check は "ok" "ng" "pending" のどれかにしてください（個人情報・画面・伝票・QRコードの確認）`);
    for (const src of [p.src, ...(p.srcset || []).map((s) => s[0])]) {
      if (!src || src.startsWith("/") || !existsSync(path.join(ROOT, src))) err(`写真ファイル ${src} が見つかりません`);
    }
  }
  if (c.status === "published") {
    const v = c.verification || {};
    if (v.facts !== "confirmed" || !str(v.by) || !/^\d{4}-\d{2}-\d{2}$/.test(v.date || "")) {
      err('公開（published）には verification.facts: "confirmed"、確認した人（by）、確認日（date）が必要です');
    }
    if (!okPhotos(c).length) err("公開（published）には、確認済み（check: \"ok\"）の写真が1枚以上必要です");
  }
}

const seen = new Set();
for (const c of all) {
  if (seen.has(c.slug)) errors.push(`${c._file}: slug「${c.slug}」が重複しています`);
  seen.add(c.slug);
}
if (errors.length) {
  console.error("記事データに問題があります：\n- " + errors.join("\n- "));
  process.exit(1);
}

const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.seq || 0) - (a.seq || 0) || a.slug.localeCompare(b.slug);
const published = all.filter((c) => c.status === "published").sort(byNewest);
const reviewing = all.filter((c) => c.status === "review" || c.status === "sample").sort(byNewest);

// ---------- 共通部品 ----------

function str(v) {
  return typeof v === "string" && v.trim() !== "";
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}
function paras(s) {
  return String(s)
    .split(/\n+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => `<p>${esc(t)}</p>`)
    .join("");
}
function plain(s) {
  return String(s || "").replace(/[\s、。・，．！？!?「」（）()]/g, "");
}
function jsonLd(graph) {
  return `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>`;
}
function abs(p) {
  return `${SITE}/${p.replace(/^\//, "")}`;
}
function jpDate(d) {
  const [y, m, day] = d.split("-").map(Number);
  return `${y}年${m}月${day}日`;
}
function okPhotos(c) {
  return (c.photos || []).filter((p) => p.check === "ok");
}
function isReview(c) {
  return c.status !== "published";
}
function url(c) {
  return isReview(c) ? `/cases/review/${c.slug}/` : `/cases/${c.slug}/`;
}
function catUrl(key, page = 1) {
  const base = key ? `/cases/${key}/` : "/cases/";
  return page > 1 ? `${base}page/${page}/` : base;
}
function deviceName(c) {
  return str(c.model) ? c.model : c.device;
}
function headline(c) {
  if (str(c.title)) return c.title;
  // 症状はタイトルを長くしすぎない範囲で添える（長い症状は本文・概要に出る）
  const sym = str(c.symptom) && [...c.symptom].length <= 20 ? `｜${c.symptom}` : "";
  return `【${c.area}】${deviceName(c)}の${c.work}${sym}`;
}
function pageTitle(c) {
  return `${headline(c)}｜${groupLabel[catByKey.get(c.category).group]}｜${STORE_SHORT}`;
}
function description(c) {
  if (str(c.description)) return c.description;
  return `${c.area}からご来店のお客様の${deviceName(c)}${c.work}の事例です。${c.summary}（茨城町の${STORE_SHORT}）`;
}
function lastmod(c) {
  return c.updated && c.updated > c.date ? c.updated : c.date;
}
function srcset(p, prefix) {
  return (p.srcset || []).map(([s, w]) => `${prefix}${s} ${w}w`).join(", ");
}
function img(p, { sizes, eager = false } = {}) {
  const set = srcset(p, "/");
  const style = p.objectPosition ? ` style="object-position:${esc(p.objectPosition)}"` : "";
  return `<img ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" src="/${esc(p.src)}"${set ? ` srcset="${esc(set)}" sizes="${sizes}"` : ""} width="${p.width}" height="${p.height}" alt="${esc(p.alt)}"${style}>`;
}

// 本文：body（自由な見出し）があればそれを使い、なければ標準項目。要約と同じ内容の項目は繰り返さない
function sections(c) {
  const list = Array.isArray(c.body) && c.body.length
    ? c.body.map((s) => ({ kind: s.kind || "", heading: s.heading, text: s.text }))
    : STD_SECTIONS.map(([k, h]) => ({ kind: k, heading: (c.headings && c.headings[k]) || h, text: c[k] }));
  const sum = plain(c.summary);
  return list.filter((s) => str(s.text) && str(s.heading) && !(sum.includes(plain(s.text)) || plain(s.text) === sum));
}
function bodyChars(c) {
  return sections(c).reduce((n, s) => n + plain(s.text).length, 0) + (c.customerComment ? plain(c.customerComment.text).length : 0);
}
function indexable(c) {
  if (isReview(c) || c.indexable === false) return false;
  if (bodyChars(c) < MIN_BODY_CHARS) {
    warnings.push(`${c._file}: 本文が短いため（${bodyChars(c)}字／目安${MIN_BODY_CHARS}字）検索対象外（noindex）にしました`);
    return false;
  }
  return true;
}
for (const c of published) c._index = indexable(c);

const css = await readFile(path.join(OUT_DIR, "cases.css"), "utf8");
const cssV = createHash("sha256").update(css.replace(/\r\n/g, "\n")).digest("hex").slice(0, 10);

const STORE_LD = {
  "@type": "MobilePhoneStore",
  "@id": `${SITE}/#store`,
  name: STORE,
  url: `${SITE}/`,
  telephone: TEL_LABEL,
  image: abs(OG_FALLBACK),
  address: { "@type": "PostalAddress", postalCode: "311-3112", addressRegion: "茨城県", addressLocality: "東茨城郡茨城町", streetAddress: "常井1156-5", addressCountry: "JP" },
};

const ICON_LINE = `<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="#fff"><path d="M12 3.2c5.3 0 9.6 3.4 9.6 7.7 0 1.9-.8 3.6-2.2 5-2 2.2-6.2 5-7.4 5.6-.6.3-.6-.2-.5-.6l.2-1.3c.1-.4 0-.7-.4-.8C6.3 18.1 2.4 14.8 2.4 10.9 2.4 6.6 6.7 3.2 12 3.2z"/><text x="12" y="13.1" text-anchor="middle" font-size="6.3" font-weight="900" font-family="Arial,Helvetica,sans-serif" fill="#06C755" textLength="12.6" lengthAdjust="spacingAndGlyphs">LINE</text></svg>`;
const ICON_TEL = `<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

function page({ title, desc, canonical, index, ogType = "website", ogImage = abs(OG_FALLBACK), ld = [], current = "/cases/", main }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
${GENERATED}
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  // 本番（oshisuma.jp）以外（プレビュー・ローカル確認）では計測を送らない
  if (location.hostname !== 'oshisuma.jp') window['ga-disable-${GA_ID}'] = true;

  gtag('config', '${GA_ID}');
</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="${index ? "index, follow, max-image-preview:large" : "noindex, nofollow"}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${STORE_SHORT}">
<meta property="og:locale" content="ja_JP">
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.ico?v=${ASSET_V}" sizes="16x16 32x32 48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=${ASSET_V}">
<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png?v=${ASSET_V}">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=${ASSET_V}">
<link rel="manifest" href="/site.webmanifest?v=${ASSET_V}">
${ld.length ? jsonLd(ld) + "\n" : ""}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=Archivo+Black&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=Archivo+Black&display=swap" rel="stylesheet"></noscript>
<link rel="stylesheet" href="/cases/cases.css?v=${cssV}">
</head>
<body>
${header(current)}
<main>
${main}
</main>
${FOOTER}
${BAR}
</body>
</html>
`;
}

const NAV = [
  ["/", "トップ"],
  ["/#trouble", "修理メニュー"],
  ["/cases/", "修理・対応事例"],
  ["/#reviews", "口コミ"],
  ["/#support", "相談・サポート"],
  ["/#used", "中古iPhone販売"],
  ["/#faq", "よくある質問"],
  ["/#access", "アクセス"],
];
const MENU = [
  ["修理・サービス", [["/", "トップ"], ["/#trouble", "修理メニュー"], ["/cases/", "修理・対応事例"], ["/#battery", "バッテリー"], ["/#support", "相談・サポート"], ["/#used", "中古iPhone販売"]]],
  ["オシスマについて", [["/#reasons", "選ばれる理由"], ["/#reviews", "口コミ"], ["/#philosophy", "オシスマの考え方"], ["/#local", "地域密着"]]],
  ["ご案内", [["/#faq", "よくある質問"], ["/#access", "アクセス"]]],
];

function header(current) {
  const cur = (h) => (h === current ? ' aria-current="page"' : "");
  const nav = NAV.map(([h, t]) => `<a href="${h}"${cur(h)}>${t}</a>`).join("");
  const menu = MENU.map(([g, links]) => `<span>${g}</span>${links.map(([h, t]) => `<a href="${h}"${cur(h)}>${t}</a>`).join("")}`).join("");
  return `<header class="cs-header"><div class="cs-header-in">
  <a class="cs-brand" href="/"><span class="cs-brand-tag">スマホ・Switch・iPad修理</span><span class="cs-brand-name">オシエテスマホ＋ 茨城町本店</span></a>
  <nav class="cs-nav" aria-label="サイト内メニュー">${nav}</nav>
  <details class="cs-menu"><summary aria-label="メニューを開く"><svg class="ic-open" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg><svg class="ic-close" aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></summary><nav class="cs-menu-panel" aria-label="サイト内メニュー">${menu}</nav></details>
</div></header>`;
}

const FOOTER = `<footer class="cs-footer"><div class="cs-wrap">
  <div class="cs-footer-grid">
    <div class="cs-footer-id"><span>スマホ・Switch・iPad修理</span><span>オシエテスマホ＋ 茨城町本店</span></div>
    <div class="cs-footer-col"><span>修理・サービス</span><a href="/#trouble">修理メニュー</a><a href="/#anshin5">修理前の安心</a><a href="/#discount">セット割</a><a href="/#battery">バッテリー</a><a href="/cases/">修理・対応事例</a><a href="/#support">相談・サポート</a><a href="/#used">中古iPhone販売</a></div>
    <div class="cs-footer-col"><span>オシスマについて</span><a href="/#reasons">選ばれる理由</a><a href="/#manga">漫画</a><a href="/#reviews">口コミ</a><a href="/#philosophy">オシスマの考え方</a><a href="/#real-moments">いつものオシスマ</a><a href="/#future">これから</a><a href="/#local">地域密着</a></div>
    <div class="cs-footer-col"><span>ご案内</span><a href="/#faq">よくある質問</a><a href="/#access">アクセス</a><a href="https://www.instagram.com/oshietesumahoplus/" target="_blank" rel="noopener noreferrer">Instagram</a><a href="${LINE_URL}">LINE</a></div>
  </div>
  <div class="cs-footer-bottom"><span>© オシエテスマホ＋ 茨城町本店</span><a href="/privacy-policy.html">プライバシーポリシー</a></div>
</div></footer>`;

const BAR = `<div class="cs-bar"><a class="tel" href="tel:${TEL}">${ICON_TEL}電話で相談</a><a class="line" href="${LINE_URL}">${ICON_LINE}LINEで相談</a></div>`;

function crumbs(items) {
  const li = items.map(([h, t], i) => (i === items.length - 1 && !h ? `<li><span aria-current="page">${esc(t)}</span></li>` : `<li><a href="${h}">${esc(t)}</a></li>`)).join("");
  return `<nav class="cs-crumbs" aria-label="パンくずリスト"><ol>${li}</ol></nav>`;
}
function crumbsLd(items) {
  return { "@type": "BreadcrumbList", itemListElement: items.map(([h, t], i) => ({ "@type": "ListItem", position: i + 1, name: t, item: abs(h) })) };
}

function card(c) {
  const cat = catByKey.get(c.category);
  const p = okPhotos(c)[0];
  const sym = str(c.symptom) ? c.symptom : c.summary;
  return `<li class="cs-card"><a href="${url(c)}">
  <span class="cs-card-img">${p ? img(p, { sizes: "(max-width:599px) 100vw, (max-width:1023px) 50vw, 380px" }) : '<span class="cs-noimg">写真は確認中です</span>'}<span class="cs-card-area">${esc(c.area)}</span></span>
  <span class="cs-card-body">
    <span class="cs-card-cat">${esc(cat.label)}</span>
    <span class="cs-card-title">${esc(deviceName(c))}｜${esc(c.work)}</span>
    <span class="cs-card-sym">${esc(sym)}</span>
    <span class="cs-card-foot"><time datetime="${c.date}">${c.date.replaceAll("-", ".")} 掲載</time><span class="cs-card-more">詳しく見る →</span></span>
  </span>
</a></li>`;
}

// ---------- 一覧（すべて・分類別、ページ分け） ----------

const outputs = new Map();
const out = (rel, html) => outputs.set(path.join(ROOT, rel), html);

function chips(currentKey) {
  const counts = new Map(categories.map((c) => [c.key, published.filter((x) => x.category === c.key).length]));
  const list = [[null, "すべて", published.length], ...categories.filter((c) => counts.get(c.key) > 0).map((c) => [c.key, c.short, counts.get(c.key)])];
  if (list.length <= 2) return ""; // 分類が1つだけなら絞り込みは出さない
  return `<nav class="cs-cats" aria-label="事例の分類"><div class="cs-cats-track">${list
    .map(([k, t, n]) => `<a class="cs-chip" href="${catUrl(k)}"${k === currentKey ? ' aria-current="page"' : ""}>${esc(t)}<small>${n}</small></a>`)
    .join("")}</div></nav>`;
}

function pager(key, pageNo, pages) {
  if (pages <= 1) return "";
  const a = [];
  if (pageNo > 1) a.push(`<a href="${catUrl(key, pageNo - 1)}" rel="prev">← 前へ</a>`);
  for (let i = 1; i <= pages; i++) a.push(i === pageNo ? `<span aria-current="page">${i}</span>` : `<a href="${catUrl(key, i)}">${i}</a>`);
  if (pageNo < pages) a.push(`<a href="${catUrl(key, pageNo + 1)}" rel="next">次へ →</a>`);
  return `<nav class="cs-pager" aria-label="ページ">${a.join("")}</nav>`;
}

const sitemapUrls = [];

function renderLists(cat) {
  const key = cat ? cat.key : null;
  const items = cat ? published.filter((c) => c.category === key) : published;
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const name = cat ? `${cat.label}の事例` : "修理・対応事例";
  const index = cat ? items.filter((c) => c._index).length >= MIN_CATEGORY_INDEX : published.some((c) => c._index);
  for (let n = 1; n <= pages; n++) {
    const slice = items.slice((n - 1) * PER_PAGE, n * PER_PAGE);
    const canonical = abs(catUrl(key, n));
    const pg = n > 1 ? `（${n}ページ目）` : "";
    const title = cat
      ? `${cat.label}の事例${pg}｜茨城町・水戸市周辺｜${STORE_SHORT}`
      : `修理・対応事例${pg}｜茨城町のiPhone・Android・Switch・iPad修理｜${STORE_SHORT}`;
    const desc = cat
      ? `茨城町の${STORE_SHORT}で対応した${cat.label}の事例です。ご来店地域・機種・症状と、どのように対応したかをご紹介します。`
      : `茨城町の${STORE_SHORT}で実際に対応した、iPhone・Android・iPad・Nintendo Switchの修理や、スマホ相談・データ移行・中古販売の事例です。`;
    const trail = cat ? [["/", "トップ"], ["/cases/", "修理・対応事例"], ["", cat.label]] : [["/", "トップ"], ["", "修理・対応事例"]];
    const ldTrail = trail.map(([h, t], i) => [h || catUrl(key), t]);
    const empty = `<div class="cs-empty">ただいま、掲載する事例を準備しています。<br>スタッフが内容を確認できた事例から、順にご紹介します。<br><a href="/#cases">トップページの最新の修理事例を見る →</a></div>`;
    const main = `<div class="cs-wrap">
  ${crumbs(trail)}
  <div class="cs-head">
    <span class="cs-label">CASES <b>/ ${cat ? esc(cat.label) : "修理・対応事例"}</b></span>
    <h1>${esc(name)}${n > 1 ? `<small style="font-size:.6em;font-weight:700"> ${n}ページ目</small>` : ""}</h1>
    <p>${cat ? `${esc(cat.label)}で実際にご来店いただいた事例です。` : "オシスマで実際に対応した、修理やご相談の記録です。"}</p>
  </div>
  ${chips(key)}
  ${items.length ? `<p class="cs-count">${items.length}件${pages > 1 ? `（${(n - 1) * PER_PAGE + 1}〜${(n - 1) * PER_PAGE + slice.length}件目）` : ""}</p>
  <ul class="cs-grid">
${slice.map(card).join("\n")}
  </ul>
  ${pager(key, n, pages)}` : empty}
  <p class="cs-foot-note">※ 料金は機種や状態によって異なるため、事例には載せていません。修理の前に、費用と方法をご説明します。</p>
</div>`;
    const ld = [
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#webpage`,
        url: canonical,
        name: name + pg,
        description: desc,
        inLanguage: "ja",
        isPartOf: { "@id": `${SITE}/#website` },
        about: { "@id": `${SITE}/#store` },
        ...(slice.length ? { mainEntity: { "@type": "ItemList", itemListElement: slice.map((c, i) => ({ "@type": "ListItem", position: (n - 1) * PER_PAGE + i + 1, url: abs(url(c)), name: headline(c) })) } } : {}),
      },
      crumbsLd(ldTrail),
      STORE_LD,
    ];
    const rel = catUrl(key, n).slice(1) + "index.html";
    out(rel, page({ title, desc, canonical, index, ld, current: "/cases/", ogImage: slice[0] ? abs(okPhotos(slice[0])[0].src) : abs(OG_FALLBACK), main }));
    if (index) sitemapUrls.push({ loc: canonical, lastmod: slice.map(lastmod).sort().at(-1) });
  }
}

renderLists(null);
for (const cat of categories) if (published.some((c) => c.category === cat.key)) renderLists(cat);

// ---------- 個別記事 ----------

function related(c) {
  const pool = published.filter((x) => x !== c);
  return [...pool.filter((x) => x.category === c.category), ...pool.filter((x) => x.category !== c.category)].slice(0, 3);
}

function renderArticle(c) {
  const cat = catByKey.get(c.category);
  const review = isReview(c);
  const h1 = headline(c);
  const canonical = abs(url(c));
  const photos = okPhotos(c);
  const [hero, ...rest] = photos;
  const hidden = (c.photos || []).length - photos.length;
  const trail = review ? [["/", "トップ"], ["/cases/review/", "確認用ページ"], ["", h1]] : [["/", "トップ"], ["/cases/", "修理・対応事例"], [catUrl(cat.key), cat.label]];

  const facts = [
    ["地域", `${c.area}からご来店`],
    ["機種", deviceName(c)],
    ["症状", c.symptom],
    ["対応", c.work],
    ["作業日", c.workDate && jpDate(c.workDate)],
  ].filter(([, v]) => str(v));

  const secs = sections(c)
    .map((s) => `<section class="cs-sec${s.kind ? ` cs-sec--${s.kind}` : ""}"><h2>${esc(s.heading)}</h2><div class="cs-sec-body">${paras(s.text)}</div></section>`)
    .join("\n    ");
  const voice = c.customerComment ? `<aside class="cs-voice"><span>お客様からいただいた言葉</span>${paras(c.customerComment.text)}</aside>` : "";
  const gallery = rest.length
    ? `<ul class="cs-photos">${rest.map((p) => `<li><figure style="margin:0">${img(p, { sizes: "(max-width:759px) 50vw, 260px" })}${str(p.caption) ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure></li>`).join("")}</ul>`
    : "";
  const rel = review ? [] : related(c);
  const v = c.verification || {};
  const banner = review
    ? `<div class="cs-review" role="note"><b>${c.status === "sample" ? "表示見本（実際の事例ではありません）" : "確認用ページ（未公開）"}</b>${
        c.status === "sample"
          ? "記事の情報が多い場合のレイアウトを確認するための見本です。文章は説明用のダミーで、写真もこの記事のための撮影ではありません。"
          : "スタッフによる事実・写真の確認が終わっていないため、一覧には載せず、検索エンジンにも表示されません。"
      }${str(v.note) ? `<ul>${v.note.split(/\n+/).map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}</div>`
    : "";
  const dates = `<time datetime="${c.date}">${jpDate(c.date)} 掲載</time>${c.updated && c.updated > c.date ? `<span>${jpDate(c.updated)} 更新</span>` : ""}`;

  const main = `<article class="cs-wrap cs-narrow cs-article">
  ${crumbs(trail)}
  ${banner}
  <div class="cs-meta">${review ? `<span class="cs-tag">${esc(cat.label)}</span>` : `<a class="cs-tag" href="${catUrl(cat.key)}">${esc(cat.label)}</a>`}${dates}</div>
  <h1>${esc(h1)}</h1>
  <p class="cs-lead">${esc(c.summary)}</p>
  ${hero ? `<figure class="cs-hero">${img(hero, { sizes: "(max-width:807px) 100vw, 760px", eager: true })}${str(hero.caption) ? `<figcaption>${esc(hero.caption)}</figcaption>` : ""}</figure>` : ""}
  ${hidden ? `<p class="cs-photo-pending">写真は、写り込みの確認が終わるまで表示していません。</p>` : ""}
  <div class="cs-facts"><dl>${facts.map(([k, val]) => `<dt>${k}</dt><dd>${esc(val)}</dd>`).join("")}</dl></div>
  <div class="cs-body">
    ${secs}
  </div>
  ${voice}
  ${gallery}
  <aside class="cs-ask">
    <p class="cs-ask-title">同じような症状でお困りですか？</p>
    <p>修理するか迷っている段階でも、お気軽にご相談ください。料金は機種や状態によって変わるため、修理の前にご説明します。<span class="cs-ask-sp">画面下のボタンから、お電話・LINEでご相談いただけます。</span></p>
    <div class="cs-ask-row"><a class="cs-btn cs-btn-tel" href="tel:${TEL}">${ICON_TEL}${TEL_LABEL}</a><a class="cs-btn cs-btn-line" href="${LINE_URL}">${ICON_LINE}LINEで相談</a></div>
    <p style="font-size:13px;color:var(--muted)">${HOURS}</p>
  </aside>
  <div class="cs-next">${
    review
      ? `<a class="cs-btn cs-btn-sub" href="/cases/review/">← 確認用ページの一覧へ</a>`
      : `<a class="cs-btn cs-btn-sub" href="${catUrl(cat.key)}">${esc(cat.label)}の事例をもっと見る</a><a class="cs-btn cs-btn-sub" href="/cases/">← 事例一覧へ</a>`
  }</div>
</article>
${rel.length ? `<section class="cs-related"><div class="cs-wrap"><span class="cs-label">RELATED <b>/ ほかの事例</b></span><h2>ほかの事例も見る</h2><ul class="cs-grid">
${rel.map(card).join("\n")}
</ul></div></section>` : ""}`;

  const ld = review
    ? []
    : [
        {
          "@type": "Article",
          "@id": `${canonical}#article`,
          headline: h1,
          description: description(c),
          url: canonical,
          mainEntityOfPage: canonical,
          image: photos.map((p) => abs(p.src)),
          datePublished: c.date,
          dateModified: lastmod(c),
          inLanguage: "ja",
          articleSection: cat.label,
          keywords: [c.area, deviceName(c), c.work, c.symptom].filter(str).join(","),
          author: { "@id": `${SITE}/#store` },
          publisher: { "@id": `${SITE}/#store` },
          about: { "@type": "Service", name: `${deviceName(c)} ${c.work}`, provider: { "@id": `${SITE}/#store` }, areaServed: c.area },
        },
        crumbsLd([["/", "トップ"], ["/cases/", "修理・対応事例"], [catUrl(cat.key), cat.label], [url(c), h1]]),
        STORE_LD,
      ];
  const index = !review && c._index;
  out(url(c).slice(1) + "index.html", page({ title: review ? `【確認用】${h1}` : pageTitle(c), desc: description(c), canonical, index, ogType: "article", ogImage: hero ? abs(hero.src) : abs(OG_FALLBACK), ld, main }));
  if (index) sitemapUrls.push({ loc: canonical, lastmod: lastmod(c) });
}

for (const c of [...published, ...reviewing]) renderArticle(c);

// 確認用ページの一覧（noindex・どこからもリンクしない）
out(
  "cases/review/index.html",
  page({
    title: "【確認用】確認待ちの事例・表示見本",
    desc: "スタッフ確認前の事例と表示見本の一覧（非公開・確認用）",
    canonical: `${SITE}/cases/review/`,
    index: false,
    main: `<div class="cs-wrap">
  ${crumbs([["/", "トップ"], ["", "確認用ページ"]])}
  <div class="cs-review" role="note"><b>確認用ページ（未公開）</b>事実・写真の確認が終わっていない事例と、表示見本の一覧です。正式な事例一覧（/cases/）には載らず、検索エンジンにも表示されません。確認が済んだ記事は status を "published" にすると正式に公開されます。</div>
  <div class="cs-head"><span class="cs-label">REVIEW <b>/ 確認待ち</b></span><h1>確認待ちの事例</h1></div>
  <p class="cs-count">${reviewing.length}件</p>
  <ul class="cs-grid">
${reviewing.map(card).join("\n")}
  </ul>
</div>`,
  })
);

// ---------- トップページ（最新3件・一覧ボタン・フッターのリンク） ----------

const topCases = [...published, ...all.filter((c) => c.legacyTopCard && c.status !== "draft" && c.status !== "published").sort(byNewest)].slice(0, 3);

function topCard(c, i) {
  const main = i === 0;
  const linked = c.status === "published";
  const p = linked ? okPhotos(c)[0] : c.photos[0];
  const tag = linked ? "a" : "div";
  const href = linked ? ` href="${url(c).slice(1)}"` : "";
  const id = main ? "case-main" : `case-sub-${i}`;
  const imgStyle = ["position:absolute;inset:0;width:100%;height:100%;object-fit:cover", p.objectPosition && `object-position:${p.objectPosition}`, p.filter && `filter:${p.filter}`].filter(Boolean).join(";");
  const set = srcset(p, "");
  const n = String(i + 1).padStart(2, "0");
  const L = main
    ? { pos: "top:20px;left:20px", gap: "8px", ls: ".16em", num: "clamp(32px,4.4vw,46px)", pad: "24px", g2: "8px", sizes: "(max-width:759px) 100vw, 680px", title: "font-size:clamp(22px,2.6vw,28px)", sum: "font-size:16px;color:rgba(255,255,255,.85);font-weight:500;line-height:1.8;max-width:32em", more: "13.5px", moreText: "事例を詳しく見る →" }
    : { pos: "top:18px;left:18px", gap: "7px", ls: ".15em", num: "clamp(26px,3.2vw,34px)", pad: "18px", g2: "6px", sizes: "(max-width:759px) 100vw, 500px", title: "font-size:17px", sum: "font-size:14px;color:rgba(255,255,255,.85);font-weight:500;line-height:1.7", more: "12.5px", moreText: "詳しく見る →" };
  return [
    `      <${tag} data-reveal id="${id}"${href} style="position:relative;display:flex;height:100%;border-radius:4px;overflow:hidden;color:#fff">`,
    `        <img loading="lazy" decoding="async" src="${esc(p.src)}"${set ? ` srcset="${esc(set)}" sizes="${L.sizes}"` : ""} width="${p.width}" height="${p.height}" alt="${esc(p.alt)}" style="${imgStyle}">`,
    `        <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,43,70,0) 40%,rgba(15,43,70,.9) 100%)"></div>`,
    `        <span style="position:absolute;${L.pos};z-index:1;display:flex;align-items:baseline;gap:${L.gap}">`,
    `          <span style="font-family:'Archivo Black',sans-serif;font-size:13px;color:#FFB37A;letter-spacing:${L.ls};text-shadow:0 1px 6px rgba(0,0,0,.5)">CASE</span>`,
    `          <span style="font-family:'Archivo Black',sans-serif;font-size:${L.num};color:#fff;line-height:1;text-shadow:0 2px 10px rgba(0,0,0,.55)">${n}</span>`,
    `        </span>`,
    `        <div style="position:relative;box-sizing:border-box;padding:${L.pad};min-height:100%;width:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:${L.g2}">`,
    `          <span style="align-self:flex-start;background:#FF6A00;color:#fff;font-size:12px;font-weight:900;padding:4px 9px;border-radius:3px;letter-spacing:.02em">${esc(c.area)}からご来店</span>`,
    `          <span style="${L.title};font-weight:900;line-height:1.35">${esc(c.device)}｜${esc(c.work)}</span>`,
    `          <span style="${L.sum}">${esc(c.summary)}</span>`,
    ...(linked ? [`          <span style="font-size:${L.more};font-weight:900;color:#FFB37A;letter-spacing:.04em">${L.moreText}</span>`] : []),
    `        </div>`,
    `      </${tag}>`,
  ];
}

const MORE_HIDDEN = [
  `    <div data-reveal hidden data-link-pending="cases-list" style="display:flex;justify-content:center;margin-top:4px">`,
  `      <a data-link-pending="cases-list" class="hv-cta-dark" style="display:inline-flex;align-items:center;gap:10px;min-height:52px;padding:0 28px;background:#FF6A00;border-radius:999px;color:#fff;font-weight:900;font-size:15px">修理事例をもっと見る →</a>`,
  `    </div>`,
];
const MORE_LIVE = [
  `    <div data-reveal style="display:flex;justify-content:center;margin-top:4px">`,
  `      <a href="cases/" class="hv-cta-dark" style="display:inline-flex;align-items:center;gap:10px;min-height:52px;padding:0 28px;background:#FF6A00;border-radius:999px;color:#fff;font-weight:900;font-size:15px">修理・対応事例をもっと見る →</a>`,
  `    </div>`,
];
const FOOTER_LINK = [`        <a href="cases/" style="color:rgba(255,255,255,.84);font-size:14.5px;font-weight:500">修理・対応事例一覧</a>`];

function region(html, name, lines) {
  const s = html.indexOf(`<!-- cases:${name}:start`);
  const e = html.indexOf(`<!-- cases:${name}:end -->`);
  if (s < 0 || e < s) throw new Error(`index.html に目印 cases:${name}:start / end が見つかりません`);
  const eol = html.includes("\r\n") ? "\r\n" : "\n";
  const a = html.indexOf("-->", s) + 3;
  const lineStart = html.lastIndexOf("\n", e) + 1;
  return html.slice(0, a) + eol + lines.map((l) => l + eol).join("") + html.slice(lineStart);
}

const indexPath = path.join(ROOT, "index.html");
let top = await readFile(indexPath, "utf8");
top = region(top, "cards", topCases.flatMap(topCard));
top = region(top, "more", published.length ? MORE_LIVE : MORE_HIDDEN);
top = region(top, "footer", published.length ? FOOTER_LINK : []);
outputs.set(indexPath, top);

// ---------- サイトマップ ----------

const sitemap = [{ loc: `${SITE}/` }, { loc: `${SITE}/privacy-policy.html` }, ...sitemapUrls];
outputs.set(
  path.join(ROOT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap
    .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ""}  </url>`)
    .join("\n")}\n</urlset>\n`
);

// ---------- 内部リンクの確認 ----------

const rel = (f) => path.relative(ROOT, f).replaceAll("\\", "/");
const known = new Set([...outputs.keys()].map(rel));
const linkErrors = [];
for (const [file, html] of outputs) {
  if (!file.endsWith(".html")) continue;
  const base = rel(file) === "index.html" ? "/" : null;
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"|srcset="([^"]+)"/g)) {
    const vals = m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().split(/\s+/)[0]);
    for (let v of vals) {
      if (/^(https?:|tel:|mailto:|#|data:)/.test(v)) continue;
      if (base && !v.startsWith("/")) v = base + v;
      if (!v.startsWith("/")) continue;
      let p = decodeURIComponent(v.split(/[?#]/)[0]).slice(1);
      if (p === "" || p.endsWith("/")) p += "index.html";
      if (!known.has(p) && !existsSync(path.join(ROOT, p))) linkErrors.push(`${rel(file)} → ${v}`);
    }
  }
}
if (linkErrors.length) {
  console.error("リンク先が見つかりません：\n- " + [...new Set(linkErrors)].join("\n- "));
  process.exit(1);
}

// ---------- 書き出し ----------

async function generatedFiles(dir) {
  const found = [];
  if (!existsSync(dir)) return found;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...(await generatedFiles(p)));
    else if (e.name === "index.html" && (await readFile(p, "utf8")).includes(GENERATED)) found.push(p);
  }
  return found;
}
const stale = (await generatedFiles(OUT_DIR)).filter((f) => !outputs.has(f));

const norm = (s) => s.replace(/\r\n/g, "\n");
const changed = [];
for (const [file, content] of outputs) {
  const current = existsSync(file) ? await readFile(file, "utf8") : null;
  if (current !== null && norm(current) === norm(content)) continue;
  changed.push(rel(file));
  if (!CHECK) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
}
for (const f of stale) {
  changed.push(`${rel(f)}（削除）`);
  if (CHECK) continue;
  await rm(f);
  for (let d = path.dirname(f); d !== OUT_DIR && (await readdir(d)).length === 0; d = path.dirname(d)) await rmdir(d);
}

console.log(`公開 ${published.length} 件（検索対象 ${published.filter((c) => c._index).length} 件）／確認待ち・見本 ${reviewing.length} 件／下書き ${all.filter((c) => c.status === "draft").length} 件`);
for (const w of warnings) console.log(`注意：${w}`);
if (CHECK && changed.length) {
  console.error("生成結果がコミット済みのファイルと違います。node tools/build-cases.mjs を実行してください：\n- " + changed.join("\n- "));
  process.exit(1);
}
console.log(changed.length ? (CHECK ? "" : "更新したファイル：\n- " + changed.join("\n- ")) : "変更はありません。");

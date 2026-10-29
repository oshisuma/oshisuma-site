// 修理・対応事例ページを content/cases/*.json から生成する。
//   node tools/build-cases.mjs          … cases/ 以下・トップページの事例カード・sitemap.xml を書き出す
//   node tools/build-cases.mjs --check  … 書き出さずに、生成結果がコミット済みのファイルと一致するかだけ確かめる
// 外部パッケージは使わない（Node.js 20 以上）。

import { readFile, writeFile, readdir, mkdir, rm, stat } from "node:fs/promises";
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
const HOURS = "営業時間 10:00〜17:00（月曜定休）";
const GA_ID = "G-QMN0B0QSLX";
const OG_FALLBACK = "optimized/og/oshietesumaho-store-exterior-og.jpg";
const ASSET_V = "20261025";
const GENERATED = "<!-- このページは tools/build-cases.mjs が content/cases/ から自動生成しています。直接編集しないでください。 -->";
const TOP_START = "<!-- cases:auto:start";
const TOP_END = "<!-- cases:auto:end -->";

const TEXT_FIELDS = ["summary", "consultation", "diagnosis", "treatment", "result", "episode", "staffComment"];
const PRICE_RE = /[0-9０-９][0-9０-９,，]*\s*円|[¥￥]|税込|税抜/;

// ---------- 読み込みと検証 ----------

const { groups, categories } = JSON.parse(await readFile(path.join(CONTENT_DIR, "_categories.json"), "utf8"));
const catByKey = new Map(categories.map((c) => [c.key, c]));
const groupByKey = new Map(groups.map((g) => [g.key, g]));

const errors = [];
const all = [];
for (const name of (await readdir(CONTENT_DIR)).sort()) {
  if (!name.endsWith(".json") || name.startsWith("_")) continue;
  let c;
  try {
    c = JSON.parse(await readFile(path.join(CONTENT_DIR, name), "utf8"));
  } catch (e) {
    errors.push(`${name}: JSON として読めません（${e.message}）`);
    continue;
  }
  c._file = name;
  validate(c);
  all.push(c);
}

function validate(c) {
  const err = (m) => errors.push(`${c._file}: ${m}`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug || "")) err("slug は半角英小文字・数字・ハイフンだけにしてください");
  if (c._file !== `${c.slug}.json`) err(`ファイル名を ${c.slug}.json にしてください`);
  if (!["published", "draft"].includes(c.status)) err('status は "published" か "draft" にしてください');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date || "")) err("date は YYYY-MM-DD 形式にしてください");
  if (c.updated && !/^\d{4}-\d{2}-\d{2}$/.test(c.updated)) err("updated は YYYY-MM-DD 形式にしてください");
  if (!catByKey.has(c.category)) err(`category「${c.category}」は _categories.json にありません`);
  for (const k of ["area", "device", "work", "summary"]) if (!str(c[k])) err(`${k} が空です`);
  if (!c.source || !str(c.source.type)) err("source.type（元になった報告の種類）が空です");
  for (const k of [...TEXT_FIELDS, "title", "description", "symptom", "work"]) {
    if (PRICE_RE.test(c[k] || "")) err(`${k} に料金の記載があります。事例には料金を掲載しない方針です`);
  }
  if (!Array.isArray(c.photos) || c.photos.length === 0) err("photos が空です（写真を1枚以上）");
  for (const p of c.photos || []) {
    if (!str(p.alt)) err(`写真 ${p.src} の alt（写真の説明）が空です`);
    if (!(p.width > 0 && p.height > 0)) err(`写真 ${p.src} の width / height を入れてください`);
    for (const src of [p.src, ...(p.srcset || []).map((s) => s[0])]) {
      if (!src || src.startsWith("/") || !existsSync(path.join(ROOT, src))) err(`写真ファイル ${src} が見つかりません`);
    }
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

const cases = all
  .filter((c) => c.status === "published")
  .sort((a, b) => b.date.localeCompare(a.date) || (b.seq || 0) - (a.seq || 0) || a.slug.localeCompare(b.slug));

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
function jsonLd(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
}
function abs(p) {
  return `${SITE}/${p.replace(/^\//, "")}`;
}
function jpDate(d) {
  const [y, m, day] = d.split("-").map(Number);
  return `${y}年${m}月${day}日`;
}
function dotDate(d) {
  return d.replaceAll("-", ".");
}
function url(c) {
  return `/cases/${c.slug}/`;
}
function deviceName(c) {
  return str(c.model) ? c.model : c.device;
}
function kindOf(c) {
  return groupByKey.get(catByKey.get(c.category).group).kind;
}
function headline(c) {
  if (str(c.title)) return c.title;
  const sym = str(c.symptom) ? `｜${c.symptom}` : "";
  return `【${c.area}】${deviceName(c)} ${c.work}${sym}`;
}
function pageTitle(c) {
  return `${headline(c)}｜${kindOf(c)}｜${STORE_SHORT}`;
}
function description(c) {
  if (str(c.description)) return c.description;
  return `${c.area}からご来店のお客様の${deviceName(c)}${c.work}の${kindOf(c)}です。${c.summary}茨城町のスマホ・Switch・iPad修理店「${STORE_SHORT}」。`;
}
function srcset(p, prefix) {
  return (p.srcset || []).map(([s, w]) => `${prefix}${s} ${w}w`).join(", ");
}
function img(p, { prefix = "/", sizes, cls = "", eager = false, style = "" } = {}) {
  const set = srcset(p, prefix);
  return `<img${cls ? ` class="${cls}"` : ""} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" src="${prefix}${esc(p.src)}"${set ? ` srcset="${esc(set)}" sizes="${sizes}"` : ""} width="${p.width}" height="${p.height}" alt="${esc(p.alt)}"${style ? ` style="${style}"` : ""}>`;
}
function photoStyle(p) {
  return [p.objectPosition && `object-position:${p.objectPosition}`].filter(Boolean).join(";");
}
function lastmod(c) {
  return c.updated && c.updated > c.date ? c.updated : c.date;
}

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

const ICON_LINE = `<svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2c5.3 0 9.6 3.4 9.6 7.7 0 1.9-.8 3.6-2.2 5-2 2.2-6.2 5-7.4 5.6-.6.3-.6-.2-.5-.6l.2-1.3c.1-.4 0-.7-.4-.8C6.3 18.1 2.4 14.8 2.4 10.9 2.4 6.6 6.7 3.2 12 3.2z"/></svg>`;
const ICON_TEL = `<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>`;

function head({ title, desc, canonical, indexable, ogType, ogImage, ld }) {
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
<meta name="robots" content="${indexable ? "index, follow, max-image-preview:large" : "noindex, follow"}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${STORE_SHORT}">
<meta property="og:locale" content="ja_JP">
<meta property="og:image" content="${ogImage}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${ogImage}">
<link rel="icon" href="/favicon.ico?v=${ASSET_V}" sizes="16x16 32x32 48x48">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png?v=${ASSET_V}">
<link rel="icon" type="image/png" sizes="192x192" href="/android-chrome-192x192.png?v=${ASSET_V}">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png?v=${ASSET_V}">
<link rel="manifest" href="/site.webmanifest?v=${ASSET_V}">
${jsonLd({ "@context": "https://schema.org", "@graph": ld })}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=Archivo+Black&display=swap" rel="stylesheet" media="print" onload="this.media='all'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700;900&family=Archivo+Black&display=swap" rel="stylesheet"></noscript>
<link rel="stylesheet" href="/cases/cases.css?v=${cssV}">
</head>`;
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

function header(current) {
  const links = NAV.map(([h, t]) => `<a href="${h}"${h === current ? ' aria-current="page"' : ""}>${t}</a>`).join("");
  return `<header class="cs-header"><div class="cs-header-in">
  <a class="cs-brand" href="/"><span class="cs-brand-tag">スマホ・Switch・iPad修理</span><span class="cs-brand-name">オシエテスマホ＋ 茨城町本店</span></a>
  <nav class="cs-nav" aria-label="サイト内メニュー">${links}</nav>
  <details class="cs-menu"><summary aria-label="メニュー"><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></summary><nav class="cs-menu-list" aria-label="サイト内メニュー">${links}</nav></details>
</div></header>`;
}

function crumbs(items) {
  const li = items
    .map(([h, t], i) => (i === items.length - 1 ? `<li><span aria-current="page">${esc(t)}</span></li>` : `<li><a href="${h}">${esc(t)}</a></li>`))
    .join("");
  return `<nav class="cs-crumbs" aria-label="パンくずリスト"><ol>${li}</ol></nav>`;
}
function crumbsLd(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map(([h, t], i) => ({ "@type": "ListItem", position: i + 1, name: t, item: abs(h) })),
  };
}

function cta(title) {
  return `<section class="cs-cta" aria-label="ご相談・お問い合わせ">
  <p class="cs-cta-title">${title}</p>
  <p class="cs-cta-text">同じような症状でお困りでしたら、LINEでお気軽にご相談ください。<br>修理するか迷っている段階でも大丈夫です。</p>
  <div class="cs-cta-row">
    <a class="cs-btn cs-btn-line" href="${LINE_URL}">${ICON_LINE}LINEで相談する</a>
    <a class="cs-btn cs-btn-tel" href="tel:${TEL}">${ICON_TEL}${TEL_LABEL}</a>
  </div>
  <p class="cs-hours">${HOURS}</p>
</section>`;
}

const STICKY = `<div class="cs-sticky"><a class="cs-btn cs-btn-line" href="${LINE_URL}">${ICON_LINE}LINEで相談</a><a class="cs-btn cs-btn-tel" href="tel:${TEL}">${ICON_TEL}電話する</a></div>`;

const FOOTER = `<footer class="cs-footer"><div class="cs-wrap">
  <div class="cs-footer-grid">
    <div class="cs-footer-col cs-footer-id"><span>スマホ・Switch・iPad修理</span><span class="cs-footer-brand">オシエテスマホ＋ 茨城町本店</span></div>
    <div class="cs-footer-col"><span>修理・サービス</span><a href="/#trouble">修理メニュー</a><a href="/cases/">修理・対応事例</a><a href="/#battery">バッテリー</a><a href="/#support">相談・サポート</a><a href="/#used">中古iPhone販売</a></div>
    <div class="cs-footer-col"><span>オシスマについて</span><a href="/#reasons">選ばれる理由</a><a href="/#reviews">口コミ</a><a href="/#philosophy">オシスマの考え方</a><a href="/#local">地域密着</a></div>
    <div class="cs-footer-col"><span>ご案内</span><a href="/#faq">よくある質問</a><a href="/#access">アクセス</a><a href="https://www.instagram.com/oshietesumahoplus/" target="_blank" rel="noopener noreferrer">Instagram</a><a href="${LINE_URL}">LINE</a></div>
  </div>
  <div class="cs-footer-bottom"><span>© オシエテスマホ＋ 茨城町本店</span><a href="/privacy-policy.html">プライバシーポリシー</a></div>
</div></footer>`;

function card(c) {
  const cat = catByKey.get(c.category);
  const p = c.photos[0];
  return `<li class="cs-card" data-cat="${cat.key}" data-group="${cat.group}"><a href="${url(c)}">
  <span class="cs-card-img">${img(p, { sizes: "(max-width:639px) 100vw, (max-width:1023px) 50vw, 380px", style: photoStyle(p) })}<span class="cs-card-cat">${esc(cat.label)}</span></span>
  <span class="cs-card-body">
    <span class="cs-card-meta"><span class="cs-pill">${esc(c.area)}</span><span class="cs-pill cs-pill-navy">${esc(deviceName(c))}</span></span>
    <span class="cs-card-title">${esc(deviceName(c))}｜${esc(c.work)}</span>
    <span class="cs-card-sum">${esc(c.summary)}</span>
    <span class="cs-card-foot"><time datetime="${c.date}">${dotDate(c.date)}</time><span class="cs-card-more">詳しく見る →</span></span>
  </span>
</a></li>`;
}

// ---------- 一覧ページ ----------

function renderList() {
  const items = [["/", "トップ"], ["/cases/", "修理・対応事例"]];
  const count = (pred) => cases.filter(pred).length;
  const chip = (key, label, n) =>
    `<button type="button" class="cs-chip${n ? "" : " is-empty"}" data-filter="${key}" aria-pressed="${key === "all"}">${esc(label)}<span class="cs-chip-n">${n}</span></button>`;
  const chips = [chip("all", "すべて", cases.length)];
  for (const g of groups) {
    chips.push(`<span class="cs-filter-sep">${esc(g.label)}</span>`);
    for (const c of categories.filter((x) => x.group === g.key)) chips.push(chip(c.key, c.short, count((x) => x.category === c.key)));
  }
  const title = `修理・対応事例一覧｜茨城町のiPhone・Android・Switch・iPad修理｜${STORE_SHORT}`;
  const desc = `茨城町の「${STORE_SHORT}」で実際に対応した、iPhone・Android・iPad・Nintendo Switchの修理事例と、スマホ相談・データ移行・中古販売などの対応事例をご紹介します。`;
  const ld = [
    {
      "@type": "CollectionPage",
      "@id": `${SITE}/cases/#webpage`,
      url: `${SITE}/cases/`,
      name: "修理・対応事例",
      description: desc,
      inLanguage: "ja",
      isPartOf: { "@id": `${SITE}/#website` },
      about: { "@id": `${SITE}/#store` },
      mainEntity: {
        "@type": "ItemList",
        itemListElement: cases.map((c, i) => ({ "@type": "ListItem", position: i + 1, url: abs(url(c)), name: headline(c) })),
      },
    },
    crumbsLd(items),
    STORE_LD,
  ];
  return `${head({ title, desc, canonical: `${SITE}/cases/`, indexable: true, ogType: "website", ogImage: abs(cases[0]?.photos[0].src || OG_FALLBACK), ld })}
<body>
${header("/cases/")}
<main>
  <div class="cs-wrap">
    ${crumbs(items)}
    <div class="cs-hero">
      <span class="cs-label">CASES</span>
      <h1>修理・対応事例</h1>
      <p class="cs-lead">茨城町の${STORE_SHORT}で、実際に対応した修理やご相談の事例をご紹介します。iPhone・Android・iPad・Nintendo Switchの修理のほか、スマホのご相談・データ移行・中古販売の事例も掲載していきます。</p>
      <p class="cs-note" style="margin-top:8px">※ 料金は機種や状態によって異なるため、事例には掲載していません。修理前に費用と方法をご説明します。</p>
    </div>
  </div>
  <div class="cs-filter"><div class="cs-filter-track" role="group" aria-label="事例の種類で絞り込む">${chips.join("")}</div></div>
  <div class="cs-wrap">
    <div class="cs-result"><span class="cs-result-n" id="cs-count" aria-live="polite">${cases.length}件</span></div>
    <ul class="cs-grid" id="cs-grid">
${cases.map(card).join("\n")}
    </ul>
    <p class="cs-empty" id="cs-empty"${cases.length ? " hidden" : ""}>この分類の事例は準備中です。順次追加していきます。</p>
    ${cta("修理・ご相談はLINEでお気軽に")}
  </div>
</main>
${FOOTER}
${STICKY}
<script>(function(){var chips=document.querySelectorAll('[data-filter]'),cards=document.querySelectorAll('#cs-grid [data-cat]'),empty=document.getElementById('cs-empty'),count=document.getElementById('cs-count');function apply(k,save){var n=0;cards.forEach(function(c){var ok=k==='all'||c.getAttribute('data-cat')===k;c.hidden=!ok;if(ok)n++;});chips.forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-filter')===k));});empty.hidden=n>0;count.textContent=n+'件';if(save){var u=new URL(location.href);if(k==='all')u.searchParams.delete('cat');else u.searchParams.set('cat',k);history.replaceState(null,'',u);}}chips.forEach(function(b){b.addEventListener('click',function(){apply(b.getAttribute('data-filter'),true);});});var q=new URLSearchParams(location.search).get('cat');apply(Array.prototype.some.call(chips,function(b){return b.getAttribute('data-filter')===q;})?q:'all',false);})();</script>
</body>
</html>
`;
}

// ---------- 個別記事 ----------

function related(c) {
  const same = cases.filter((x) => x !== c && x.category === c.category);
  const others = cases.filter((x) => x !== c && x.category !== c.category);
  return [...same, ...others].slice(0, 3);
}

function renderArticle(c) {
  const cat = catByKey.get(c.category);
  const h1 = headline(c);
  const title = pageTitle(c);
  const desc = description(c);
  const canonical = abs(url(c));
  const items = [["/", "トップ"], ["/cases/", "修理・対応事例"], [url(c), h1]];
  const [hero, ...rest] = c.photos;

  const facts = [
    ["地域", `${c.area}からご来店`],
    ["機種", deviceName(c)],
    ["症状・ご相談", c.symptom],
    ["対応内容", c.work],
    ["結果", c.result],
  ].filter(([, v]) => str(v));

  const sec = (h, body, cls = "") => (str(body) ? `<section class="cs-sec"><h2>${h}</h2><div${cls ? ` class="${cls}"` : ""}>${paras(body)}</div></section>` : "");
  const gallery = rest.length
    ? `<section class="cs-sec"><h2>写真</h2><ul class="cs-gallery">${rest
        .map((p) => `<li><figure style="margin:0">${img(p, { sizes: "(max-width:819px) 50vw, 400px" })}${str(p.caption) ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure></li>`)
        .join("")}</ul></section>`
    : "";
  const rel = related(c);

  const ld = [
    {
      "@type": "Article",
      "@id": `${canonical}#article`,
      headline: h1,
      description: desc,
      url: canonical,
      mainEntityOfPage: canonical,
      image: c.photos.map((p) => abs(p.src)),
      datePublished: c.date,
      dateModified: lastmod(c),
      inLanguage: "ja",
      articleSection: cat.label,
      keywords: [c.area, deviceName(c), c.work, c.symptom].filter(str).join(","),
      author: { "@id": `${SITE}/#store` },
      publisher: { "@id": `${SITE}/#store` },
      about: { "@type": "Service", name: `${deviceName(c)} ${c.work}`, provider: { "@id": `${SITE}/#store` }, areaServed: c.area },
    },
    crumbsLd(items),
    STORE_LD,
  ];

  return `${head({ title, desc, canonical, indexable: c.indexable !== false, ogType: "article", ogImage: abs(hero.src), ld })}
<body>
${header("/cases/")}
<main>
  <article class="cs-wrap cs-narrow">
    ${crumbs(items)}
    <header class="cs-article-head">
      <div class="cs-article-meta"><a class="cs-pill" href="/cases/?cat=${cat.key}" style="background:var(--or);color:#fff">${esc(cat.label)}</a><span class="cs-pill">${esc(c.area)}</span><time class="cs-date" datetime="${c.date}">${jpDate(c.date)} 掲載</time></div>
      <h1>${esc(h1)}</h1>
    </header>
    <figure class="cs-figure">${img(hero, { sizes: "(max-width:819px) 100vw, 820px", eager: true })}${str(hero.caption) ? `<figcaption>${esc(hero.caption)}</figcaption>` : ""}</figure>
    <section class="cs-facts" aria-label="この事例の概要">
      <p class="cs-facts-title">この事例のまとめ</p>
      <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
    </section>
    <div class="cs-body">
      ${sec("ご相談内容", c.consultation)}
      ${sec("診断・ご説明", c.diagnosis)}
      ${sec("対応内容", c.treatment)}
      ${sec("結果", c.result)}
      ${sec("お客様のエピソード", c.episode, "cs-voice")}
      ${sec("スタッフより", c.staffComment, "cs-staff")}
      ${gallery}
    </div>
    <p class="cs-fee">料金は機種・状態・部品によって異なるため、事例には掲載していません。修理前に費用と方法をご説明し、ご納得いただいてから作業します。</p>
    ${cta(`${esc(deviceName(c))}の${esc(c.work)}、オシスマにご相談ください`)}
  </article>
  ${
    rel.length
      ? `<section class="cs-related"><div class="cs-wrap"><span class="cs-label">RELATED</span><h2>ほかの事例</h2><ul class="cs-grid">
${rel.map(card).join("\n")}
</ul><div class="cs-back"><a class="cs-btn cs-btn-or" href="/cases/">修理・対応事例の一覧へ →</a></div></div></section>`
      : `<div class="cs-back"><a class="cs-btn cs-btn-or" href="/cases/">修理・対応事例の一覧へ →</a></div>`
  }
</main>
${FOOTER}
${STICKY}
</body>
</html>
`;
}

// ---------- トップページの事例カード（最新3件） ----------

function topCard(c, i, eol) {
  const main = i === 0;
  const p = c.photos[0];
  const imgStyle = ["position:absolute;inset:0;width:100%;height:100%;object-fit:cover", p.objectPosition && `object-position:${p.objectPosition}`, p.filter && `filter:${p.filter}`].filter(Boolean).join(";");
  const set = srcset(p, "");
  const n = String(i + 1).padStart(2, "0");
  const lines = main
    ? [
        `      <a data-reveal id="case-main" href="${url(c).slice(1)}" style="position:relative;display:flex;height:100%;border-radius:4px;overflow:hidden;color:#fff">`,
        `        <img loading="lazy" decoding="async" src="${esc(p.src)}"${set ? ` srcset="${esc(set)}" sizes="(max-width:759px) 100vw, 680px"` : ""} width="${p.width}" height="${p.height}" alt="${esc(p.alt)}" style="${imgStyle}">`,
        `        <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,43,70,0) 40%,rgba(15,43,70,.9) 100%)"></div>`,
        `        <span style="position:absolute;top:20px;left:20px;z-index:1;display:flex;align-items:baseline;gap:8px">`,
        `          <span style="font-family:'Archivo Black',sans-serif;font-size:13px;color:#FFB37A;letter-spacing:.16em;text-shadow:0 1px 6px rgba(0,0,0,.5)">CASE</span>`,
        `          <span style="font-family:'Archivo Black',sans-serif;font-size:clamp(32px,4.4vw,46px);color:#fff;line-height:1;text-shadow:0 2px 10px rgba(0,0,0,.55)">${n}</span>`,
        `        </span>`,
        `        <div style="position:relative;box-sizing:border-box;padding:24px;min-height:100%;width:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:8px">`,
        `          <span style="align-self:flex-start;background:#FF6A00;color:#fff;font-size:12px;font-weight:900;padding:4px 9px;border-radius:3px;letter-spacing:.02em">${esc(c.area)}からご来店</span>`,
        `          <span style="font-size:clamp(22px,2.6vw,28px);font-weight:900;line-height:1.35">${esc(c.device)}｜${esc(c.work)}</span>`,
        `          <span style="font-size:16px;color:rgba(255,255,255,.85);font-weight:500;line-height:1.8;max-width:32em">${esc(c.summary)}</span>`,
        `          <span style="font-size:13.5px;font-weight:900;color:#FFB37A;letter-spacing:.04em">事例を詳しく見る →</span>`,
        `        </div>`,
        `      </a>`,
      ]
    : [
        `      <a data-reveal id="case-sub-${i}" href="${url(c).slice(1)}" style="position:relative;display:flex;height:100%;border-radius:4px;overflow:hidden;color:#fff">`,
        `        <img loading="lazy" decoding="async" src="${esc(p.src)}"${set ? ` srcset="${esc(set)}" sizes="(max-width:759px) 100vw, 500px"` : ""} width="${p.width}" height="${p.height}" alt="${esc(p.alt)}" style="${imgStyle}">`,
        `        <div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,43,70,0) 40%,rgba(15,43,70,.9) 100%)"></div>`,
        `        <span style="position:absolute;top:18px;left:18px;z-index:1;display:flex;align-items:baseline;gap:7px">`,
        `          <span style="font-family:'Archivo Black',sans-serif;font-size:13px;color:#FFB37A;letter-spacing:.15em;text-shadow:0 1px 6px rgba(0,0,0,.5)">CASE</span>`,
        `          <span style="font-family:'Archivo Black',sans-serif;font-size:clamp(26px,3.2vw,34px);color:#fff;line-height:1;text-shadow:0 2px 10px rgba(0,0,0,.55)">${n}</span>`,
        `        </span>`,
        `        <div style="position:relative;box-sizing:border-box;padding:18px;min-height:100%;width:100%;display:flex;flex-direction:column;justify-content:flex-end;gap:6px">`,
        `          <span style="align-self:flex-start;background:#FF6A00;color:#fff;font-size:12px;font-weight:900;padding:4px 9px;border-radius:3px;letter-spacing:.02em">${esc(c.area)}からご来店</span>`,
        `          <span style="font-size:17px;font-weight:900;line-height:1.35">${esc(c.device)}｜${esc(c.work)}</span>`,
        `          <span style="font-size:14px;color:rgba(255,255,255,.85);font-weight:500;line-height:1.7">${esc(c.summary)}</span>`,
        `          <span style="font-size:12.5px;font-weight:900;color:#FFB37A;letter-spacing:.04em">詳しく見る →</span>`,
        `        </div>`,
        `      </a>`,
      ];
  return lines.join(eol);
}

function renderTop(html) {
  const s = html.indexOf(TOP_START);
  const e = html.indexOf(TOP_END);
  if (s < 0 || e < s) throw new Error("index.html に事例カードの目印（cases:auto:start / end）が見つかりません");
  const eol = html.includes("\r\n") ? "\r\n" : "\n";
  const startLine = html.slice(s, html.indexOf("-->", s) + 3);
  const block = [startLine, ...cases.slice(0, 3).map((c, i) => topCard(c, i, eol)), `      ${TOP_END}`].join(eol);
  return html.slice(0, s) + block + html.slice(e + TOP_END.length);
}

// ---------- サイトマップ ----------

function renderSitemap() {
  const urls = [
    { loc: `${SITE}/` },
    { loc: `${SITE}/privacy-policy.html` },
    { loc: `${SITE}/cases/`, lastmod: cases.map(lastmod).sort().at(-1) },
    ...cases.filter((c) => c.indexable !== false).map((c) => ({ loc: abs(url(c)), lastmod: lastmod(c) })),
  ];
  const body = urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ""}  </url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// ---------- 書き出し ----------

const outputs = new Map();
outputs.set(path.join(OUT_DIR, "index.html"), renderList());
for (const c of cases) outputs.set(path.join(OUT_DIR, c.slug, "index.html"), renderArticle(c));
const indexPath = path.join(ROOT, "index.html");
outputs.set(indexPath, renderTop(await readFile(indexPath, "utf8")));
outputs.set(path.join(ROOT, "sitemap.xml"), renderSitemap());

// 公開をやめた記事（生成済みフォルダが残っているもの）
const stale = [];
for (const d of await readdir(OUT_DIR)) {
  const f = path.join(OUT_DIR, d, "index.html");
  if (!(await stat(path.join(OUT_DIR, d))).isDirectory() || outputs.has(f) || !existsSync(f)) continue;
  if ((await readFile(f, "utf8")).includes(GENERATED)) stale.push(path.join(OUT_DIR, d));
}

const norm = (s) => s.replace(/\r\n/g, "\n");
const rel = (f) => path.relative(ROOT, f).replaceAll("\\", "/");
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
for (const d of stale) {
  changed.push(`${rel(d)}/（削除）`);
  if (!CHECK) await rm(d, { recursive: true });
}

if (CHECK && changed.length) {
  console.error("生成結果がコミット済みのファイルと違います。node tools/build-cases.mjs を実行してください：\n- " + changed.join("\n- "));
  process.exit(1);
}
console.log(`公開中の事例 ${cases.length} 件（下書き ${all.length - cases.length} 件）`);
console.log(changed.length ? (CHECK ? "" : "更新したファイル：\n- " + changed.join("\n- ")) : "変更はありません。");

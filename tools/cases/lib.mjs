// 修理報告データ（1件＝1ファイル）から、HP記事・一覧カード・Google最新情報の下書きを作る共通処理。
// ページの外枠（ヘッダー・お問い合わせ・店舗情報・フッター）は、公開済みの記事ページをそのまま読み込んで使う。
// 公開済みの記事・一覧・画像は書き換えない。

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITE = 'https://oshisuma.jp';
export const CASES_URL = '/repair/cases/';
// デザインの基準にする公開済み記事（外枠をここから読み込む）
export const REFERENCE_ARTICLE = 'repair/cases/2026-11-13-mito-iphone13pro-screen-battery/index.html';
export const REPORTS_DIR = 'content/case-reports';
export const PREVIEW_DIR = 'repair/cases/_preview';

// 店舗の所在地。本文に出てもよい市町村（お客様の地域とは別）
export const STORE_AREA = '茨城町';
// 本文に出てきたら、報告の地域と一致しているかを確かめる市町村名
export const KNOWN_AREAS = [
  '水戸市', '茨城町', '大洗町', 'ひたちなか市', '鉾田市', '笠間市', '小美玉市', '那珂市',
  '城里町', '石岡市', '行方市', '東海村', '日立市', '常陸大宮市', '筑西市', '土浦市', 'つくば市'
];

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- 外枠の読み込み

// Windowsの作業フォルダでは改行がCRLFになっていることがあるため、LF（公開されている形）にそろえて読む
export const readText = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const SLOTS = [
  ['title', /<title>[^<]*<\/title>/],
  ['description', /<meta name="description" content="[^"]*">/],
  ['robots', /<meta name="robots" content="[^"]*">/],
  ['canonical', /<link rel="canonical" href="[^"]*">/],
  ['ogTitle', /<meta property="og:title" content="[^"]*">/],
  ['ogDescription', /<meta property="og:description" content="[^"]*">/],
  ['ogUrl', /<meta property="og:url" content="[^"]*">/],
  ['ogImage', /<meta property="og:image" content="[^"]*">/],
  ['crumb', /<span class="case-crumb-current">[^<]*<\/span>/],
  ['eyebrow', /<p class="case-eyebrow">[^<]*<\/p>/],
  ['h1', /<h1>.*?<\/h1>/],
  ['body', /  <div class="case-article-summary">[\s\S]*?(?=  <nav class="case-return-nav")/]
];

// 公開済み記事から、記事ごとに変わる部分を目印に置き換えた「外枠」を作る
export function loadShell(html = readText(REFERENCE_ARTICLE)) {
  let shell = html.replace(/\r\n/g, '\n');
  for (const [name, re] of SLOTS) {
    const all = shell.match(new RegExp(re.source, 'g')) || [];
    if (all.length !== 1) {
      throw new Error(`基準の記事ページで「${name}」の場所が特定できません（${all.length}か所）。基準ページの構造が変わった可能性があります。`);
    }
    shell = shell.replace(re, `{{${name}}}`);
  }
  return shell;
}

// ---------------------------------------------------------------- HP記事

export function hpTitle(hp) {
  const head = hp.titleArea ? `【${hp.titleArea}】` : '';
  return `${head}${hp.titleDevice}の${hp.titleServices.join('・')}`;
}

export function articleUrl(hp) {
  return `${CASES_URL}${hp.slug}/`;
}

function renderH1(hp) {
  const services = hp.titleServices.map((s, i) =>
    `<span class="case-nb">${esc(s)}${i < hp.titleServices.length - 1 ? '・' : ''}</span>`).join('');
  return `<h1><span class="case-nb">${esc(hp.titleDevice)}の</span><br class="case-title-break">${services}</h1>`;
}

function renderBody(report) {
  const hp = report.drafts.hp;
  const photo = featurePhoto(report);
  const works = report.facts.works;
  const workDd = works.length > 1
    ? `<dd class="case-work-items">${works.map((w) => `<span class="case-work-item">${esc(w)}</span>`).join('')}</dd>`
    : `<dd>${esc(works[0])}</dd>`;
  const sections = hp.sections.map((sec, i) => {
    const paras = sec.paragraphs.map((p) => {
      const text = typeof p === 'string' ? p : p.text;
      const cls = typeof p === 'object' && p.note ? ' class="case-small-note"' : '';
      return `      <p${cls}>${esc(text)}</p>\n`;
    }).join('');
    return '    <section class="case-story-section">\n' +
      `      <div class="case-story-head"><span class="case-step-number">${String(i + 1).padStart(2, '0')}</span><h2>${esc(sec.heading)}</h2></div>\n` +
      paras +
      '    </section>\n';
  }).join('');
  return '  <div class="case-article-summary">\n' +
    '    <figure class="case-feature">\n' +
    `      <div class="case-feature-photo"><img src="${esc(photo.src)}" alt="${esc(photo.alt)}" width="${photo.width}" height="${photo.height}" decoding="async"></div>\n` +
    `      <figcaption>${esc(photo.caption)}</figcaption>\n` +
    '    </figure>\n' +
    '    <dl class="case-facts">\n' +
    `      <div><dt>機種</dt><dd>${esc(report.facts.device.name)}</dd></div>\n` +
    `      <div><dt>対応</dt>${workDd}</div>\n` +
    '    </dl>\n' +
    '  </div>\n\n' +
    '  <div class="case-story">\n' +
    sections +
    '  </div>\n\n';
}

export function featurePhoto(report) {
  const id = report.drafts.hp.featureMedia;
  const p = report.media.find((m) => m.id === id);
  if (!p) throw new Error(`${report.reportId}: 記事の写真 ${id} が media にありません。`);
  return p;
}

export function cardPhoto(report) {
  const id = report.drafts.hp.cardMedia;
  const p = report.media.find((m) => m.id === id);
  if (!p) throw new Error(`${report.reportId}: 一覧用の写真 ${id} が media にありません。`);
  return p;
}

// preview: true のときは検索エンジンに載せない設定にする（それ以外は公開記事と同じ）
export function renderArticle(report, { shell = loadShell(), preview = false } = {}) {
  const hp = report.drafts.hp;
  const title = hpTitle(hp);
  const fullTitle = `${title}｜オシスマ修理事例`;
  const url = SITE + articleUrl(hp);
  const photo = featurePhoto(report);
  const year = hp.date.slice(0, 4);
  const values = {
    title: `<title>${esc(fullTitle)}</title>`,
    description: `<meta name="description" content="${esc(hp.description)}">`,
    robots: preview
      ? '<meta name="robots" content="noindex,nofollow">'
      : '<meta name="robots" content="index,follow,max-image-preview:large">',
    canonical: `<link rel="canonical" href="${esc(url)}">`,
    ogTitle: `<meta property="og:title" content="${esc(fullTitle)}">`,
    ogDescription: `<meta property="og:description" content="${esc(hp.description)}">`,
    ogUrl: `<meta property="og:url" content="${esc(url)}">`,
    ogImage: `<meta property="og:image" content="${esc(SITE + photo.src)}">`,
    crumb: `<span class="case-crumb-current">${esc(title)}</span>`,
    eyebrow: `<p class="case-eyebrow">REPAIR CASES / ${esc(year)}</p>`,
    h1: renderH1(hp),
    body: renderBody(report)
  };
  return shell.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? values[k] : m));
}

// 一覧ページ（/repair/cases/）のカード1枚分。公開済みカードと同じ書き方
export function renderCard(report) {
  const hp = report.drafts.hp;
  const photo = cardPhoto(report);
  const meta = [`<span>${esc(hp.date.slice(0, 4))}年</span>`];
  if (hp.titleArea) meta.push('<span aria-hidden="true">·</span>', `<span>${esc(hp.titleArea)}</span>`);
  return `    <article class="case-list-card"><a href="${esc(articleUrl(hp))}">\n` +
    `      <div class="case-list-image"><img src="${esc(photo.src)}" alt="${esc(photo.alt)}" width="${photo.width}" height="${photo.height}" loading="lazy" decoding="async"></div>\n` +
    '      <div class="case-list-body">\n' +
    `        <div class="case-list-meta">${meta.join('')}</div>\n` +
    `        <h2><span class="case-title-device">${esc(hp.titleDevice)}</span><span class="case-title-service">${esc(hp.titleServices.join('・'))}</span></h2>\n` +
    `        <p>${esc(hp.cardSummary)}</p>\n` +
    '        <span class="case-list-more">修理内容を詳しく見る →</span>\n' +
    '      </div>\n' +
    '    </a></article>\n';
}

// ---------------------------------------------------------------- Google最新情報

// Googleビジネスプロフィールの「最新情報」投稿の下書き（APIへは送らない）
export function renderGbpPost(report) {
  const gbp = report.drafts.gbp;
  const hp = report.drafts.hp;
  const photo = report.media.find((m) => m.id === gbp.media);
  return {
    languageCode: 'ja',
    topicType: 'STANDARD',
    summary: gbp.summary,
    callToAction: { actionType: 'LEARN_MORE', url: SITE + articleUrl(hp) },
    media: photo ? [{ mediaFormat: 'PHOTO', sourceUrl: SITE + photo.src }] : []
  };
}

// ---------------------------------------------------------------- 読み込み・確認

export function loadReports(dir = join(ROOT, REPORTS_DIR)) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.json') && !ent.name.startsWith('_')) {
        out.push({ file: p, report: JSON.parse(readFileSync(p, 'utf8')) });
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// JPEG・PNG・WebP の実際の縦横サイズを読む
export function imageSize(file) {
  const b = readFileSync(file);
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), type: 'png', bytes: b.length };
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), type: 'webp', bytes: b.length };
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, type: 'webp', bytes: b.length };
    if (kind === 'VP8L') {
      const v = b.readUInt32LE(21);
      return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1, type: 'webp', bytes: b.length };
    }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), type: 'jpeg', bytes: b.length };
      }
      i += 2 + len;
    }
  }
  throw new Error(`画像の大きさを読み取れません：${file}`);
}

const PRICE_RE = /[0-9０-９,，]+\s*円|¥|￥|税込|税抜/;
const AGE_GENDER_RE = /[0-9０-９]+\s*(代|歳|才)|男性|女性|ご年配|高齢|お子様|おじいちゃん|おばあちゃん/;
const PHONE_RE = /0\d{1,4}[-‐－ー]?\d{1,4}[-‐－ー]?\d{3,4}|tel:/i;
const URL_RE = /https?:\/\//i;
export const GBP_SUMMARY_MAX = 1500;

// 1件分の確認。errors があれば記事は作らない。warnings は確認ページに表示する
export function validateReport(report, { root = ROOT } = {}) {
  const errors = [];
  const warnings = [];
  const r = report;
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(r.schemaVersion === 1, 'schemaVersion は 1 にしてください。');
  need(/^[A-Za-z0-9-]+$/.test(r.reportId || ''), 'reportId がありません（英数字とハイフン）。');
  need(['test', 'draft', 'review', 'approved', 'published'].includes(r.status), 'status が正しくありません。');
  const f = r.facts || {};
  const hp = (r.drafts || {}).hp || {};
  const gbp = (r.drafts || {}).gbp || {};
  need(f.device && f.device.name, 'facts.device.name（機種）がありません。');
  need(Array.isArray(f.works) && f.works.length > 0, 'facts.works（対応内容）がありません。');
  need(Array.isArray(r.media) && r.media.length > 0, 'media（写真）がありません。');
  need(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(hp.slug || ''), 'drafts.hp.slug は「YYYY-MM-DD-英小文字とハイフン」にしてください。');
  need(/^\d{4}-\d{2}-\d{2}$/.test(hp.date || ''), 'drafts.hp.date（掲載日）がありません。');
  need(hp.titleDevice && Array.isArray(hp.titleServices) && hp.titleServices.length, 'drafts.hp のタイトル（機種・修理内容）がありません。');
  need(Array.isArray(hp.sections) && hp.sections.length, 'drafts.hp.sections（本文）がありません。');
  need(hp.description && hp.cardSummary, 'drafts.hp の description・cardSummary がありません。');
  need(typeof gbp.summary === 'string' && gbp.summary.length > 0, 'drafts.gbp.summary（Google投稿の本文）がありません。');
  if (errors.length) return { errors, warnings };

  // 報告にない事実を足していないか
  if (f.device.name !== hp.titleDevice) errors.push(`記事タイトルの機種「${hp.titleDevice}」が報告の機種「${f.device.name}」と違います。`);
  const area = f.area ? f.area.name : null;
  if ((hp.titleArea || null) !== area) errors.push(`記事タイトルの地域「${hp.titleArea || 'なし'}」が報告の地域「${area || 'なし'}」と違います。`);
  for (const s of hp.titleServices) {
    if (!f.works.includes(s)) errors.push(`タイトルの修理内容「${s}」が報告の対応内容にありません。`);
  }
  const hpText = [hp.description, hp.cardSummary, ...hp.sections.flatMap((s) => [s.heading, ...s.paragraphs.map((p) => (typeof p === 'string' ? p : p.text))]), ...r.media.flatMap((m) => [m.alt, m.caption])].join('\n');
  const texts = { 'HP記事': hpText, 'Google投稿': gbp.summary };
  for (const [label, text] of Object.entries(texts)) {
    if (PRICE_RE.test(text)) errors.push(`${label}に料金が書かれています。`);
    if (AGE_GENDER_RE.test(text)) errors.push(`${label}に年代・年齢・性別などが書かれています。`);
    for (const a of KNOWN_AREAS) {
      if (text.includes(a) && a !== area && a !== STORE_AREA) errors.push(`${label}に、報告と違う地域「${a}」が書かれています。`);
    }
  }
  if (PHONE_RE.test(gbp.summary)) errors.push('Google投稿の本文に電話番号があります（投稿が却下されることがあるため、本文には書かない）。');
  if (URL_RE.test(gbp.summary)) errors.push('Google投稿の本文にURLがあります（記事へのリンクは「詳細」ボタンで付けます）。');
  if (gbp.summary.length > GBP_SUMMARY_MAX) errors.push(`Google投稿の本文が${gbp.summary.length}文字です（上限${GBP_SUMMARY_MAX}文字）。`);
  if (!gbp.summary.includes(f.device.name)) warnings.push('Google投稿の本文に機種名がありません。');

  // 写真
  const ids = new Set();
  for (const m of r.media) {
    if (ids.has(m.id)) errors.push(`写真の id「${m.id}」が重複しています。`);
    ids.add(m.id);
    if (!m.alt) errors.push(`写真 ${m.id} の alt（説明文）がありません。`);
    const file = join(root, (m.src || '').replace(/^\//, ''));
    if (!m.src || !existsSync(file)) { errors.push(`写真 ${m.id} のファイルがありません：${m.src}`); continue; }
    const size = imageSize(file);
    if (size.width !== m.width || size.height !== m.height) {
      errors.push(`写真 ${m.id} の大きさが違います（データ ${m.width}×${m.height}／実際 ${size.width}×${size.height}）。`);
    }
    const ready = r.status === 'approved' || r.status === 'published';
    if (m.privacyCheck !== 'ok') (ready ? errors : warnings).push(`写真 ${m.id} の個人情報チェックが「${m.privacyCheck || '未確認'}」です。`);
    if (m.contentMatch !== 'ok') (ready ? errors : warnings).push(`写真 ${m.id} と報告内容の一致確認が「${m.contentMatch || '未確認'}」です。`);
  }
  for (const key of ['featureMedia', 'cardMedia']) {
    if (!ids.has(hp[key])) errors.push(`drafts.hp.${key}「${hp[key]}」が media にありません。`);
  }
  if (gbp.media && !ids.has(gbp.media)) errors.push(`drafts.gbp.media「${gbp.media}」が media にありません。`);
  return { errors, warnings };
}

// 全件の確認（報告ID・URLの重複、公開済みページの上書き防止）
export function validateAll(entries, { root = ROOT } = {}) {
  const problems = [];
  const seenId = new Map();
  const seenSlug = new Map();
  for (const { file, report } of entries) {
    const { errors, warnings } = validateReport(report, { root });
    const slug = report.drafts && report.drafts.hp && report.drafts.hp.slug;
    if (seenId.has(report.reportId)) errors.push(`reportId「${report.reportId}」が ${seenId.get(report.reportId)} と重複しています（二重登録）。`);
    seenId.set(report.reportId, file);
    if (slug) {
      if (seenSlug.has(slug)) errors.push(`記事のURL「${slug}」が ${seenSlug.get(slug)} と重複しています。`);
      seenSlug.set(slug, file);
      if (existsSync(join(root, 'repair', 'cases', slug)) && report.status !== 'published') {
        errors.push(`記事のURL「${slug}」はすでに公開済みのページがあります（上書きしません）。`);
      }
    }
    problems.push({ file, report, errors, warnings });
  }
  return problems;
}

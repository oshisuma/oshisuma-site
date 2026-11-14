// 段階①のテスト：node tools/cases/test.mjs
//  1. 公開済みの記事2件・一覧カード2枚を、このプログラムで作り直すと1文字も違わないか（デザインを変えていないことの確認）
//  2. 報告にない事実・料金・年代性別・電話番号・違う地域・写真の不備・二重登録・上書きを止められるか
//  3. 確認用ページが検索に載らない設定で、公開済みのファイルを書き換えていないか
// 公開済みページの文章は、確認のためにメモリ上で読むだけで、新しいファイルには保存しない。

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ROOT, loadShell, renderArticle, renderCard, renderGbpPost, validateReport, validateAll, loadReports,
  imageSize, PREVIEW_DIR
} from './lib.mjs';

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ○ ${name}`); } else { fail++; console.log(`  × ${name}${detail ? `\n      ${detail}` : ''}`); }
}
// 公開済みのファイルは、本番と同じ main の中身（git）から読む
const readMain = (rel) => execFileSync('git', ['show', `origin/main:${rel}`], { cwd: ROOT, encoding: 'utf8' });
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const pick = (html, re) => { const m = html.match(re); if (!m) throw new Error(`見つかりません：${re}`); return unesc(m[1]); };
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return i >= a.length && a.length === b.length ? '' : `${i}文字目から違います：「${a.slice(i, i + 60)}」／「${b.slice(i, i + 60)}」`;
}

// 公開済み記事のHTMLを、報告データの形に読み直す（テストの中だけで使う）
function parseArticle(html, slug) {
  const crumb = pick(html, /<span class="case-crumb-current">([^<]*)<\/span>/);
  const h1 = html.match(/<h1>(.*?)<\/h1>/)[1];
  const spans = [...h1.matchAll(/<span class="case-nb">([^<]*)<\/span>/g)].map((m) => unesc(m[1]));
  const titleDevice = spans[0].replace(/の$/, '');
  const titleServices = spans.slice(1).map((s) => s.replace(/・$/, ''));
  const areaMatch = crumb.match(/^【([^】]+)】/);
  const img = html.match(/<div class="case-feature-photo"><img src="([^"]*)" alt="([^"]*)" width="(\d+)" height="(\d+)"/);
  const caption = pick(html, /<figcaption>([^<]*)<\/figcaption>/);
  const device = pick(html, /<dt>機種<\/dt><dd>([^<]*)<\/dd>/);
  const workDd = html.match(/<dt>対応<\/dt><dd[^>]*>(.*?)<\/dd>/)[1];
  const works = workDd.includes('case-work-item')
    ? [...workDd.matchAll(/<span class="case-work-item">([^<]*)<\/span>/g)].map((m) => unesc(m[1]))
    : [unesc(workDd)];
  const sections = [...html.matchAll(/<section class="case-story-section">([\s\S]*?)<\/section>/g)].map((m) => ({
    heading: unesc(m[1].match(/<h2>([^<]*)<\/h2>/)[1]),
    paragraphs: [...m[1].matchAll(/<p( class="case-small-note")?>([^<]*)<\/p>/g)].map((p) => (p[1] ? { text: unesc(p[2]), note: true } : unesc(p[2])))
  }));
  const year = pick(html, /<p class="case-eyebrow">REPAIR CASES \/ (\d{4})<\/p>/);
  return {
    reportId: slug,
    facts: { device: { name: device }, works, area: areaMatch ? { name: areaMatch[1] } : null },
    media: [{ id: 'p1', src: unesc(img[1]), alt: unesc(img[2]), width: Number(img[3]), height: Number(img[4]), caption }],
    drafts: { hp: {
      slug, date: `${year}-01-01`, titleArea: areaMatch ? areaMatch[1] : null, titleDevice, titleServices,
      description: pick(html, /<meta name="description" content="([^"]*)">/), featureMedia: 'p1', cardMedia: 'p1', sections
    } }
  };
}

console.log('\n【1】公開済みページを作り直して、1文字も違わないか');
const shell = loadShell();
const published = ['2026-11-13-mito-iphone13pro-screen-battery', '2026-11-13-hitachinaka-switch-battery'];
for (const slug of published) {
  const html = readMain(`repair/cases/${slug}/index.html`);
  check(`${slug}：外枠（ヘッダー・お問い合わせ・店舗情報・フッター）が基準ページと同じ`, loadShell(html) === shell);
  const rebuilt = renderArticle(parseArticle(html, slug), { shell });
  check(`${slug}：記事ページ全体が完全に一致`, rebuilt === html, firstDiff(rebuilt, html));
}
const listHtml = readMain('repair/cases/index.html');
const cards = [...listHtml.matchAll(/    <article class="case-list-card">[\s\S]*?<\/a><\/article>\n/g)].map((m) => m[0]);
check('一覧ページのカードが2枚ある', cards.length === 2, `${cards.length}枚`);
for (const card of cards) {
  const slug = card.match(/href="\/repair\/cases\/([^/]+)\//)[1];
  const img = card.match(/<img src="([^"]*)" alt="([^"]*)" width="(\d+)" height="(\d+)"/);
  const meta = card.match(/<div class="case-list-meta">(.*?)<\/div>/)[1];
  const year = meta.match(/<span>(\d{4})年<\/span>/)[1];
  const area = (meta.match(/<span>([^<]*)<\/span>$/) || [])[1];
  const report = {
    media: [{ id: 'c', src: img[1], alt: unesc(img[2]), width: Number(img[3]), height: Number(img[4]) }],
    drafts: { hp: {
      slug, date: `${year}-01-01`, titleArea: area && area !== `${year}年` ? area : null,
      titleDevice: unesc(card.match(/<span class="case-title-device">([^<]*)<\/span>/)[1]),
      titleServices: unesc(card.match(/<span class="case-title-service">([^<]*)<\/span>/)[1]).split('・'),
      cardSummary: unesc(card.match(/<p>([^<]*)<\/p>/)[1]), cardMedia: 'c'
    } }
  };
  const rebuilt = renderCard(report);
  check(`一覧カード ${slug}：完全に一致`, rebuilt === card, firstDiff(rebuilt, card));
}

console.log('\n【2】テストデータ（架空）の確認');
const entries = loadReports();
check('テストデータが5件ある', entries.length === 5, `${entries.length}件`);
for (const r of validateAll(entries)) {
  check(`${r.report.reportId}：エラーなし`, r.errors.length === 0, r.errors.join(' / '));
}
const base = JSON.parse(read('content/case-reports/test/TEST-0001.json'));
const post = renderGbpPost(base);
check('Google投稿の下書き：本文・詳細ボタン・写真URLがそろう',
  post.summary === base.drafts.gbp.summary && post.callToAction.url === 'https://oshisuma.jp/repair/cases/2026-11-20-test-mito-iphonese2-screen/' &&
  post.media[0].sourceUrl === 'https://oshisuma.jp/uploads/iphone-careful-disassembly-hands.jpg');
const t2 = validateReport(JSON.parse(read('content/case-reports/test/TEST-0002.json')));
check('写真と報告の一致が未確認なら「注意」として表示する', t2.warnings.some((w) => w.includes('一致確認')));

console.log('\n【3】まちがったデータを止められるか');
const mutate = (fn) => { const r = structuredClone(base); fn(r); return validateReport(r).errors.join(' / '); };
const expectError = (name, fn, word) => { const e = mutate(fn); check(name, e.includes(word), e || 'エラーが出ませんでした'); };
expectError('報告と違う機種をタイトルに書く', (r) => { r.drafts.hp.titleDevice = 'iPhone 15'; }, '報告の機種');
expectError('報告にない地域をタイトルに書く', (r) => { r.drafts.hp.titleArea = '笠間市'; }, '報告の地域');
expectError('地域が不明なのに水戸市と書く', (r) => { r.facts.area = null; r.drafts.hp.titleArea = null; }, '報告と違う地域「水戸市」');
expectError('報告にない修理内容をタイトルに書く', (r) => { r.drafts.hp.titleServices = ['画面修理', 'バッテリー交換']; }, '報告の対応内容にありません');
expectError('本文に料金', (r) => { r.drafts.hp.sections[1].paragraphs.push('修理代は12,800円でした。'); }, '料金');
expectError('本文に年代・性別', (r) => { r.drafts.hp.sections[0].paragraphs.push('70代の男性のお客様です。'); }, '年代');
expectError('Google投稿に電話番号', (r) => { r.drafts.gbp.summary += '\n090-5014-5311'; }, '電話番号');
expectError('Google投稿にURL', (r) => { r.drafts.gbp.summary += '\nhttps://oshisuma.jp/'; }, 'URL');
expectError('Google投稿が1500文字を超える', (r) => { r.drafts.gbp.summary = 'iPhone SE（第2世代）'.padEnd(1501, 'あ'); }, '上限1500文字');
expectError('写真のファイルがない', (r) => { r.media[0].src = '/uploads/not-found.jpg'; }, 'ファイルがありません');
expectError('写真の大きさ（width・height）が実物と違う', (r) => { r.media[0].width = 800; }, '大きさが違います');
expectError('写真の alt がない', (r) => { r.media[0].alt = ''; }, 'alt');
expectError('承認済みなのに写真が個人情報チェック前', (r) => { r.status = 'approved'; r.media[0].privacyCheck = 'pending'; }, '個人情報チェック');
expectError('承認済みなのに写真と報告の一致が未確認', (r) => { r.status = 'approved'; r.media[0].contentMatch = 'mismatch'; }, '一致確認');
expectError('記事の写真の指定まちがい', (r) => { r.drafts.hp.featureMedia = 'p9'; }, 'featureMedia');
expectError('URLの形がまちがっている', (r) => { r.drafts.hp.slug = 'Test Page'; }, 'slug');

const dupe = validateAll([
  { file: 'a.json', report: base },
  { file: 'b.json', report: structuredClone(base) }
]);
check('同じ報告IDの二重登録を止める', dupe[1].errors.some((e) => e.includes('二重登録')));
check('同じ記事URLの重複を止める', dupe[1].errors.some((e) => e.includes('記事のURL') && e.includes('重複')));
const overwrite = structuredClone(base);
overwrite.drafts.hp.slug = published[0];
check('公開済み記事と同じURLは上書きしない', validateAll([{ file: 'c.json', report: overwrite }])[0].errors.some((e) => e.includes('上書きしません')));

console.log('\n【4】確認用ページと、公開済みファイルの保護');
for (const { report } of entries) {
  // 写真の確認待ちで記事を作っていない報告は、段階②のテスト（test-photos.mjs）で確かめる
  if (validateReport(report).blocked.length) continue;
  const dir = join(ROOT, PREVIEW_DIR, report.drafts.hp.slug);
  const html = existsSync(join(dir, 'index.html')) ? readFileSync(join(dir, 'index.html'), 'utf8') : '';
  check(`${report.reportId}：確認用の記事ページがある`, html.length > 0);
  check(`${report.reportId}：検索に載らない設定（noindex）`, html.includes('<meta name="robots" content="noindex,nofollow">'));
  const srcs = [...html.matchAll(/<img src="([^"]+)"[^>]*width="(\d+)" height="(\d+)"/g)];
  check(`${report.reportId}：ページ内の画像がすべて存在し、大きさも一致`, srcs.length > 0 && srcs.every((m) => {
    const f = join(ROOT, m[1].replace(/^\//, ''));
    if (!existsSync(f)) return false;
    const s = imageSize(f);
    return s.width === Number(m[2]) && s.height === Number(m[3]);
  }));
  check(`${report.reportId}：一覧ページ・サイトマップ・トップからリンクされていない`,
    !listHtml.includes(report.drafts.hp.slug) && !read('sitemap.xml').includes(report.drafts.hp.slug) && !read('index.html').includes(report.drafts.hp.slug));
}
const changed = execFileSync('git', ['diff', '--name-only', 'origin/main', '--'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);
const allowed = (p) => /^(tools\/cases\/|content\/case-reports\/|repair\/cases\/_preview\/|docs\/case-automation\.md$)/.test(p);
const outside = [...changed, ...untracked].filter((p) => !allowed(p));
check('公開済みのページ・画像・CSS・トップページを1つも変更していない', outside.length === 0, outside.join(', '));

console.log(`\n結果：成功 ${pass}件／失敗 ${fail}件`);
process.exit(fail ? 1 : 0);

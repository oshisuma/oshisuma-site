// 段階②のテスト（写真の自動処理）：node tools/cases/test-photos.mjs <テスト用の元写真フォルダ>
// 元写真フォルダは make-test-originals.mjs で作ったもの（リポジトリの外）。

import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { ROOT, PREVIEW_DIR, loadReports, validateReport, validateAll, renderGbpPost, imageSize } from './lib.mjs';
import {
  RENDITIONS, SIZE_LIMITS, FILE_NAME_RE, assessPhoto, makeAlt, chooseMedia, baseName, uniqueStem,
  existingImageNames, scanMetadata, isPublishable
} from './photos.mjs';
import { startBrowser, processPhoto } from './browser.mjs';
import { TEST_ORIGINALS } from './make-test-originals.mjs';

const originals = process.argv[2];
if (!originals || !existsSync(originals)) { console.error('テスト用の元写真フォルダを指定してください。'); process.exit(1); }

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ○ ${name}`); } else { fail++; console.log(`  × ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const reports = Object.fromEntries(loadReports().map(({ report }) => [report.reportId, report]));
const r3 = reports['TEST-0003'];
const r4 = reports['TEST-0004'];
const r5 = reports['TEST-0005'];
const imagesDir = join(ROOT, PREVIEW_DIR, 'images');
const outFiles = readdirSync(imagesDir);

console.log('\n【5】撮影情報（位置情報など）の削除');
const origMeta = TEST_ORIGINALS.map(([name]) => scanMetadata(readFileSync(join(originals, name))));
check('テスト用の元写真には、位置情報（GPS）と撮影情報が入っている（削除の確認の前提）', origMeta.every((m) => m.gps && m.exif));
const leaked = outFiles.filter((f) => { const m = scanMetadata(readFileSync(join(imagesDir, f))); return m.gps || m.exif || m.xmp || m.other.length; });
check(`公開用の画像${outFiles.length}個すべてに、位置情報・撮影情報が残っていない`, outFiles.length > 0 && leaked.length === 0, leaked.join(', '));
check('元写真は変更していない（処理の前後で同じ）', TEST_ORIGINALS.every(([name]) => scanMetadata(readFileSync(join(originals, name))).gps));
check('元写真はリポジトリに入っていない', !existsSync(join(ROOT, 'IMG_9001.jpg')) && !execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).includes('IMG_9'));

console.log('\n【6】ファイル名（SEO）・重複防止');
check('水戸市・iPhone 12・画面修理・作業日 → mito-iphone12-screen-repair-20261122', baseName(r3.facts) === 'mito-iphone12-screen-repair-20261122', baseName(r3.facts));
check('地域が不明なときは地域を入れない → nintendo-switch-battery-replacement-20261123', baseName(r4.facts) === 'nintendo-switch-battery-replacement-20261123', baseName(r4.facts));
check('対応表にない地域は推測せず、ファイル名に入れない', baseName({ ...r3.facts, area: { name: '架空市' } }) === 'iphone12-screen-repair-20261122');
let threw = '';
try { baseName({ ...r3.facts, works: ['ふしぎな修理'] }); } catch (e) { threw = e.message; }
check('対応表にない修理内容は止める（勝手に英語にしない）', threw.includes('対応表'));
check('ファイル名はすべて英小文字・数字・ハイフンだけ', outFiles.every((f) => FILE_NAME_RE.test(f)), outFiles.filter((f) => !FILE_NAME_RE.test(f)).join(', '));
check('ファイル名に検索語が1回ずつ（詰め込みなし）', outFiles.every((f) => (f.match(/repair|replacement/g) || []).length <= 1));
const taken = new Set(['mito-iphone12-screen-repair-20261122.jpg']);
check('同じ名前がすでにあれば番号を付ける（-2）', uniqueStem('mito-iphone12-screen-repair-20261122', 1, taken) === 'mito-iphone12-screen-repair-20261122-2');
const existing = existingImageNames();
check('既存の画像（公開済みの修理事例4個を含む）を名前の重複チェックの対象にしている',
  ['mito-iphone13pro-screen-damage-20261113.jpg', 'hitachinaka-nintendo-switch-battery-repair-20261113-card.jpg', 'iphone-repair-staff-hero.webp'].every((n) => existing.has(n)));
const published = execFileSync('git', ['diff', '--name-only', 'origin/main', '--', 'repair/cases/images', 'uploads', 'optimized'], { cwd: ROOT, encoding: 'utf8' }).trim();
check('既存の画像（repair/cases/images・uploads・optimized）を1つも変更していない', published === '', published);

// 同じ報告をもう一度処理しても、写真が増えない
const before = readdirSync(imagesDir).length;
const again = execFileSync('node', ['tools/cases/ingest-photos.mjs', '--originals', originals], { cwd: ROOT, encoding: 'utf8' });
check('同じ報告を2回処理しても写真は増えない（二重処理の防止）', readdirSync(imagesDir).length === before && again.includes('処理済み'));

console.log('\n【7】圧縮・WebP・サムネイル・大きさ');
for (const r of [r3, r4]) {
  const m = r.media.find(isPublishable);
  const s = (src) => imageSize(join(ROOT, src.slice(1)));
  const main = s(m.src); const mainW = s(m.webp); const card = s(m.card.src); const cardW = s(m.card.webp); const gbp = s(m.gbp.src);
  check(`${r.reportId}：記事用 JPEG ${main.width}×${main.height}・${Math.round(main.bytes / 1024)}KB（上限 横900・縦1250・300KB）`, main.width <= 900 && main.height <= 1250 && main.bytes <= SIZE_LIMITS['main.jpg']);
  check(`${r.reportId}：記事用 WebP ${Math.round(mainW.bytes / 1024)}KB（JPEGと同じ大きさ・形式はWebP）`, mainW.type === 'webp' && mainW.width === main.width && mainW.height === main.height);
  check(`${r.reportId}：一覧用 800×600（JPEG ${Math.round(card.bytes / 1024)}KB・WebP ${Math.round(cardW.bytes / 1024)}KB）`, card.width === 800 && card.height === 600 && cardW.type === 'webp' && card.bytes <= SIZE_LIMITS['card.jpg']);
  check(`${r.reportId}：Google用 1200×900（${Math.round(gbp.bytes / 1024)}KB、10KB以上5MB以下）`, gbp.width === 1200 && gbp.height === 900 && gbp.bytes >= 10240 && gbp.bytes <= 5 * 1024 * 1024);
  check(`${r.reportId}：データの width・height が実物と一致`, m.width === main.width && m.height === main.height && m.card.width === 800 && m.gbp.width === 1200);
}
const browser = await startBrowser();
const tmp = mkdtempSync(join(tmpdir(), 'oshisuma-rot-'));
const rot = await processPhoto(browser, join(originals, 'IMG_9101_rotated.jpg'), RENDITIONS);
const flat = await processPhoto(browser, join(originals, 'IMG_9004.jpg'), RENDITIONS);
browser.close();
const rotMain = rot.renditions.find((x) => x.key === 'main' && x.type === 'image/jpeg');
check(`スマホの写真の向き（回転情報）を反映する：横長 ${flat.source.width}×${flat.source.height} に「90度回転」の印 → 縦長 ${rot.source.width}×${rot.source.height}`, rot.source.width === flat.source.height && rot.source.height === flat.source.width && rotMain.height > rotMain.width);
writeFileSync(join(tmp, 'rot.jpg'), Buffer.from(rotMain.base64, 'base64'));
check('回転した写真の書き出しにも撮影情報が残っていない', !scanMetadata(readFileSync(join(tmp, 'rot.jpg'))).exif);

console.log('\n【8】公開リスク・報告との一致の判定');
const okReview = { confidence: 'high', people: 'hands', risks: [], device: 'iphone', shows: 'during' };
const a = (rv) => assessPhoto(rv, r3.facts);
check('判定がまだない写真は「確認待ち」', a(undefined).privacyCheck === 'pending' && a(undefined).contentMatch === 'pending');
check('判定に自信がない写真は「確認待ち」', a({ ...okReview, confidence: 'low' }).privacyCheck === 'pending');
check('人物の顔が写っている写真は「確認待ち」', a({ ...okReview, people: 'face' }).privacyCheck === 'pending');
check('人物が写っているか不確かな写真は「確認待ち」', a({ ...okReview, people: 'uncertain' }).privacyCheck === 'pending');
for (const risk of ['screen', 'document', 'barcode', 'idcard', 'handwriting', 'price', 'address']) {
  check(`「${risk}」が写っている写真は「確認待ち」`, a({ ...okReview, risks: [risk] }).privacyCheck === 'pending');
}
check('報告と違う端末の写真は「報告と不一致」', a({ ...okReview, device: 'switch' }).contentMatch === 'mismatch');
check('修理と関係ない写真は「報告と不一致」', a({ ...okReview, shows: 'other' }).contentMatch === 'mismatch');
check('手元だけ・個人情報なし・報告と一致 → 公開できる', a(okReview).privacyCheck === 'ok' && a(okReview).contentMatch === 'ok');
check('TEST-0003：顔・料金・手書きの写真（p2）と、書類・バーコードの写真（p3）は公開用の画像を作らない',
  !r3.media[1].src && !r3.media[2].src && r3.media[1].privacyCheck === 'pending' && r3.media[2].contentMatch === 'mismatch');
check('TEST-0005：写真の判定がない報告は、写真を1枚も公開せず、記事も作らない',
  r5.media.every((m) => !m.src) && validateReport(r5).blocked.length > 0 && !existsSync(join(ROOT, PREVIEW_DIR, r5.drafts.hp.slug, 'index.html')));
const approved5 = { ...structuredClone(r5), status: 'approved' };
check('確認待ちのまま「承認」にすると止まる', validateReport(approved5).errors.some((e) => e.includes('公開できる写真')));

console.log('\n【9】alt・使い分け');
check('altは日本語で、機種名を含む', [r3, r4].every((r) => r.media.every((m) => m.alt.includes(r.facts.device.name))));
check('写真の説明がないときは仮のalt（確認待ち）', makeAlt(undefined, r3.facts, 1) === 'iPhone 12の画面修理（写真2）');
const pick = [{ id: 'a', shows: 'after', privacyCheck: 'ok', contentMatch: 'ok' }, { id: 'b', shows: 'before', privacyCheck: 'ok', contentMatch: 'ok' }, { id: 'c', shows: 'during', privacyCheck: 'ok', contentMatch: 'ok' }, { id: 'd', shows: 'before', privacyCheck: 'pending', contentMatch: 'ok' }];
check('HPは「修理前→作業中→修理後」、Googleは「作業中→修理後→修理前」の順で、公開できる写真から選ぶ', chooseMedia(pick, 'hp') === 'b' && chooseMedia(pick, 'gbp') === 'c');
const g3 = renderGbpPost(r3);
check('Google投稿にはGoogle用（1200×900）の画像を使う', g3.media[0].sourceUrl.endsWith('-gbp.jpg'));
const art3 = readFileSync(join(ROOT, PREVIEW_DIR, r3.drafts.hp.slug, 'index.html'), 'utf8');
check('HP記事はWebP（対応ブラウザ）とJPEG（それ以外）の両方を用意', art3.includes('<picture><source srcset="/repair/cases/_preview/images/mito-iphone12-screen-repair-20261122.webp" type="image/webp"><img src="/repair/cases/_preview/images/mito-iphone12-screen-repair-20261122.jpg"'));
const rv3 = readFileSync(join(ROOT, PREVIEW_DIR, r3.drafts.hp.slug, 'review.html'), 'utf8');
check('HP一覧のカードは一覧用（800×600）の画像を使う', rv3.includes('mito-iphone12-screen-repair-20261122-card.webp') && rv3.includes('width="800" height="600"'));

console.log('\n【10】報告の写真の枚数（2〜5枚）');
const withPhotos = (n) => { const r = structuredClone(r3); r.intake.photos = Array.from({ length: n }, (_, i) => ({ original: `x${i}.jpg` })); return validateReport(r).errors.join(' '); };
check('1枚の報告は止める', withPhotos(1).includes('2〜5枚'));
check('2枚・5枚の報告は受け付ける', !withPhotos(2).includes('2〜5枚') && !withPhotos(5).includes('2〜5枚'));
check('6枚の報告は止める', withPhotos(6).includes('2〜5枚'));
check('全報告の確認でエラーなし', validateAll(loadReports()).every((x) => x.errors.length === 0));

console.log(`\n結果：成功 ${pass}件／失敗 ${fail}件`);
process.exit(fail ? 1 : 0);

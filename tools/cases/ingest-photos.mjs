// 段階②：報告に添付された写真（2〜5枚）を取り込み、公開用の写真を作る
//   node tools/cases/ingest-photos.mjs --originals <元写真のフォルダ>
//
// - 元写真は読むだけで、変更・移動・削除しない（本番では Googleドライブに置いたまま）
// - 公開してよいと判定された写真（個人情報OK・報告と一致）だけを、縮小・切り抜き・撮影情報の削除をして書き出す
// - 判定が不確か・人物や個人情報が写っている写真は書き出さず「確認待ち」にする
// - 同じ名前のファイルがあれば番号を付ける（上書きしない）。同じ報告を2回処理しても、写真は増えない
// - 画像処理は photo-process.js をEdge（画面なし）で動かして行う（今後のスマホ確認ページと同じ処理）

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, loadReports, PREVIEW_DIR } from './lib.mjs';
import {
  MIN_PHOTOS, MAX_PHOTOS, RENDITIONS, assessPhoto, isPublishable, makeAlt, chooseMedia, baseName,
  existingImageNames, uniqueStem
} from './photos.mjs';
import { startBrowser, processPhoto } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const originalsDir = opt('--originals');
const only = opt('--report');
// --reprocess … 処理済みの報告を、人が確認したうえで作り直す（その報告が作った画像だけを置き換える）
const reprocess = args.includes('--reprocess');
if (!originalsDir) { console.error('--originals <元写真のフォルダ> を指定してください。'); process.exit(1); }

// ---------------------------------------------------------------- 取り込み
const hashOf = (report) => {
  const h = createHash('sha256');
  for (const p of report.intake.photos) {
    h.update(p.original);
    const f = join(originalsDir, p.original);
    if (existsSync(f)) h.update(readFileSync(f));
    h.update(JSON.stringify(p.review || null));
  }
  h.update(JSON.stringify(report.facts));
  return h.digest('hex').slice(0, 16);
};

const entries = loadReports().filter(({ report }) => report.intake && Array.isArray(report.intake.photos) && (!only || report.reportId === only));
let browser = null;
let failed = false;

for (const { file, report } of entries) {
  const name = relative(ROOT, file).replace(/\\/g, '/');
  const photos = report.intake.photos;
  try {
    if (photos.length < MIN_PHOTOS || photos.length > MAX_PHOTOS) {
      throw new Error(`写真は${MIN_PHOTOS}〜${MAX_PHOTOS}枚にしてください（${photos.length}枚）。`);
    }
    const hash = hashOf(report);
    if (report.intake.processed && report.intake.processed.hash === hash && !reprocess) {
      console.log(`- ${name}：処理済みのため、写真は作り直しません（二重処理の防止）`);
      continue;
    }
    if (report.intake.processed && !reprocess) {
      throw new Error('この報告の写真はすでに処理済みで、内容が変わっています。上書きを防ぐため止めました（作り直す場合は、人が確認してから processed を消してください）。');
    }
    const outRel = report.status === 'test' ? `${PREVIEW_DIR}/images` : 'repair/cases/images';
    mkdirSync(join(ROOT, outRel), { recursive: true });
    const base = baseName(report.facts);
    const taken = existingImageNames();
    // 作り直しのときは、この報告が前回作った画像だけを置き換えてよい（ほかの画像は上書きしない）
    const own = new Set();
    if (reprocess) {
      for (const m of report.media || []) {
        for (const src of [m.src, m.webp, m.card && m.card.src, m.card && m.card.webp, m.gbp && m.gbp.src].filter(Boolean)) {
          own.add(src.slice(1));
          taken.delete(src.split('/').pop().toLowerCase());
        }
      }
    }
    const media = [];
    let n = 0;
    for (const [i, p] of photos.entries()) {
      const src = join(originalsDir, p.original);
      if (!existsSync(src)) throw new Error(`元写真が見つかりません：${p.original}`);
      const a = assessPhoto(p.review, report.facts);
      const item = {
        id: `p${i + 1}`,
        original: `${report.intake.originalsRef || 'drive'}:${p.original}`,
        shows: p.review ? p.review.shows : null,
        privacyCheck: a.privacyCheck,
        contentMatch: a.contentMatch,
        checkNotes: a.reasons,
        alt: makeAlt(p.review, report.facts, i),
        caption: (p.review && p.review.caption) || ''
      };
      if (isPublishable(item)) {
        browser = browser || await startBrowser();
        const result = await processPhoto(browser, src, RENDITIONS, p.review.crop);
        const crop = p.review.crop || { w: 1, h: 1 };
        const usedW = Math.round(result.source.width * crop.w);
        const usedH = Math.round(result.source.height * crop.h);
        if (usedW < 1200 || usedH < 900) {
          item.qualityNote = `使った範囲が${usedW}×${usedH}pxと小さいため、Google用（1200×900）${usedW < 800 || usedH < 600 ? '・一覧用（800×600）' : ''}は拡大され、粗く見えることがあります。`;
        }
        const stem = uniqueStem(base, ++n, taken);
        const files = {};
        for (const r of result.renditions) {
          if (r.unsupported) continue;
          const suffix = r.key === 'main' ? '' : `-${r.key}`;
          const ext = r.type === 'image/webp' ? 'webp' : 'jpg';
          const rel = `${outRel}/${stem}${suffix}.${ext}`;
          if (existsSync(join(ROOT, rel)) && !own.has(rel)) throw new Error(`同じ名前のファイルがあります（上書きしません）：${rel}`);
          writeFileSync(join(ROOT, rel), Buffer.from(r.base64, 'base64'));
          files[`${r.key}.${ext}`] = { src: `/${rel}`, width: r.width, height: r.height };
        }
        item.src = files['main.jpg'].src;
        item.width = files['main.jpg'].width;
        item.height = files['main.jpg'].height;
        if (files['main.webp']) item.webp = files['main.webp'].src;
        item.card = { ...files['card.jpg'], ...(files['card.webp'] ? { webp: files['card.webp'].src } : {}) };
        item.gbp = files['gbp.jpg'];
        if (!item.caption) item.caption = `${item.alt}。`;
      }
      media.push(item);
    }
    report.media = media;
    const feature = chooseMedia(media, 'hp');
    report.drafts.hp.featureMedia = feature;
    report.drafts.hp.cardMedia = feature;
    report.drafts.gbp.media = chooseMedia(media, 'gbp');
    report.intake.processed = { hash, at: new Date().toISOString().slice(0, 10) };
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    const ok = media.filter(isPublishable).length;
    console.log(`○ ${name}：写真${photos.length}枚 → 公開用${ok}枚を作成、確認待ち${photos.length - ok}枚`);
  } catch (e) {
    failed = true;
    console.log(`× ${name}：${e.message}`);
  }
}
if (browser) browser.close();
process.exit(failed ? 1 : 0);

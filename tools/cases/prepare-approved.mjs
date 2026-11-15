// 承認済みの公開候補の写真から、公開用の画像を作る（本番連携・方法A）
//   node tools/cases/prepare-approved.mjs --candidates <承認済みの公開候補JSON> --photos <写真のコピーのフォルダ> --out <出力JSON>
//
// - 写真のコピーは、承認画面（Apps Script）が受け渡し用フォルダに置いたもの（<フォルダ>/<報告ID>/<写真ID>.jpg など）
// - オーナーが承認画面で「公開OK」にした写真のうち、記事・一覧・Google投稿に使うものだけを処理する
// - 縮小・WebP・一覧用（800×600）・Google用（1200×900）を作り、撮影情報（位置情報など）は消える（段階②と同じ処理）
// - ファイル名は地域・機種・修理内容・作業日から作る。既存の画像と重なれば番号を付ける（上書きしない）
// - 元写真のコピーは読むだけ。承認の指紋は「元写真＋alt」で計算するため、画像を作っても変わらない

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, fingerprint } from './lib.mjs';
import { RENDITIONS, baseName, existingImageNames, uniqueStem, isPublishable } from './photos.mjs';
import { startBrowser, processPhoto } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const [candFile, photosDir, outFile] = [opt('--candidates'), opt('--photos'), opt('--out')];
if (!candFile || !photosDir || !outFile) { console.error('--candidates・--photos・--out を指定してください。'); process.exit(1); }

const input = JSON.parse(readFileSync(candFile, 'utf8'));
const taken = existingImageNames();
let browser = null;
let failed = false;

for (const c of input.candidates) {
  const r = c.report;
  const id = c.reportId;
  try {
    const fpBefore = fingerprint(r, 'hp');
    const isTest = r.status === 'test' || (r.source && r.source.type === 'test');
    const outRel = isTest ? 'repair/cases/_preview/images' : 'repair/cases/images';
    const hp = r.drafts.hp;
    const usedIds = [...new Set([hp.featureMedia, hp.cardMedia, r.drafts.gbp && r.drafts.gbp.media].filter(Boolean))];
    const base = baseName(r.facts);
    let n = 0;
    for (const mid of usedIds) {
      const m = r.media.find((x) => x.id === mid);
      if (!m) throw new Error(`写真 ${mid} がありません。`);
      if (!isPublishable(m)) throw new Error(`写真 ${mid} はオーナーの「公開OK」になっていません。`);
      if (!m.alt) throw new Error(`写真 ${mid} の alt がありません。`);
      if (m.card) { n++; continue; }                         // すでに作ってある（二重に作らない）
      const dir = join(photosDir, id);
      const file = existsSync(dir) && readdirSync(dir).find((f) => f.replace(/\.[^.]+$/, '') === mid);
      if (!file) throw new Error(`写真 ${mid} のコピーが受け渡し用フォルダにありません（${dir}）。`);
      browser = browser || await startBrowser();
      const result = await processPhoto(browser, join(dir, file), RENDITIONS, m.crop || null);
      const stem = uniqueStem(base, ++n, taken);
      mkdirSync(join(ROOT, outRel), { recursive: true });
      const files = {};
      for (const x of result.renditions) {
        if (x.unsupported) continue;
        const suffix = x.key === 'main' ? '' : `-${x.key}`;
        const ext = x.type === 'image/webp' ? 'webp' : 'jpg';
        const rel = `${outRel}/${stem}${suffix}.${ext}`;
        if (existsSync(join(ROOT, rel))) throw new Error(`同じ名前のファイルがあります（上書きしません）：${rel}`);
        writeFileSync(join(ROOT, rel), Buffer.from(x.base64, 'base64'));
        files[`${x.key}.${ext}`] = { src: `/${rel}`, width: x.width, height: x.height };
      }
      Object.assign(m, files['main.jpg']);
      if (files['main.webp']) m.webp = files['main.webp'].src;
      m.card = { ...files['card.jpg'], ...(files['card.webp'] ? { webp: files['card.webp'].src } : {}) };
      m.gbp = files['gbp.jpg'];
      const crop = m.crop || { w: 1, h: 1 };
      const usedW = Math.round(result.source.width * crop.w);
      const usedH = Math.round(result.source.height * crop.h);
      if (usedW < 1200 || usedH < 900) m.qualityNote = `使った範囲が${usedW}×${usedH}pxのため、Google用（1200×900）は拡大されています。`;
    }
    if (fingerprint(r, 'hp') !== fpBefore) throw new Error('画像を作ったことで承認の指紋が変わりました（処理を止めます）。');
    console.log(`○ ${id}：公開用の画像を用意しました（写真${usedIds.length}枚）`);
  } catch (e) {
    failed = true;
    c.prepareError = e.message;
    console.log(`× ${id}：${e.message}`);
  }
}
if (browser) browser.close();
writeFileSync(outFile, JSON.stringify({ ...input, candidates: input.candidates.filter((c) => !c.prepareError) }, null, 2));
process.exit(failed ? 1 : 0);

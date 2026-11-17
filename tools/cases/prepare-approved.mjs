// 承認済みの公開候補の写真から、公開用の画像を作る（本番連携・方法A）
//   node tools/cases/prepare-approved.mjs --candidates <承認済みの公開候補JSON> --photos <写真のコピーのフォルダ> --out <出力JSON>
//                                         [--gbp-out <Google写真一覧用の画像を置くフォルダ（リポジトリの外）>]
//
// - 写真のコピーは、承認画面（Apps Script）が受け渡し用フォルダに置いたもの（<フォルダ>/<報告ID>/<写真ID>.jpg など）
// - オーナーが承認画面で「公開OK」にした写真だけを処理する（元の写真・コピーは読むだけ）
// - 写真名は SEO・MEO 向けに「地域-機種-修理内容-01」（2枚目は 02）。既存の画像と重なれば掲載日を入れる（上書きしない）
// - HP用（縮小・WebP・一覧用800×600・Google最新情報用1200×900）はリポジトリの repair/cases/images/ に作る
// - Google写真一覧用（切り抜かず長辺2048px・高画質）は --gbp-out のフォルダ（リポジトリの外）に作る
// - どれも描き直すため、位置情報などの撮影情報は消える（段階②と同じ処理）
// - 承認の指紋は「元写真＋alt」で計算するため、画像を作っても変わらない（変わったら止める）

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { ROOT, fingerprint } from './lib.mjs';
import { RENDITIONS, GBP_PHOTO_RENDITION, GBP_PHOTO_LIMITS, existingImageNames, seoStems, isPublishable } from './photos.mjs';
import { startBrowser, processPhoto } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const [candFile, photosDir, outFile, gbpOut] = [opt('--candidates'), opt('--photos'), opt('--out'), opt('--gbp-out')];
if (!candFile || !photosDir || !outFile) { console.error('--candidates・--photos・--out を指定してください。'); process.exit(1); }
if (gbpOut) {
  const rel = relative(ROOT, resolve(gbpOut));
  if (!rel.startsWith('..') && !isAbsolute(rel)) { console.error('--gbp-out はリポジトリの外のフォルダにしてください（写真一覧用の画像はHPに置きません）。'); process.exit(1); }
}
const HP_SUFFIXES = ['.jpg', '.webp', '-card.jpg', '-card.webp', '-gbp.jpg'];

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
    // 使う写真：HP記事・一覧・Google最新情報に使う写真は「公開OK」が必須
    for (const mid of [hp.featureMedia, hp.cardMedia, r.drafts.gbp && r.drafts.gbp.media].filter(Boolean)) {
      const m = r.media.find((x) => x.id === mid);
      if (!m) throw new Error(`写真 ${mid} がありません。`);
      if (!isPublishable(m)) throw new Error(`写真 ${mid} はオーナーの「公開OK」になっていません。`);
      if (!m.alt) throw new Error(`写真 ${mid} の alt がありません。`);
    }
    // 番号（01・02…）は「公開OK」の写真の並び順で付ける（HP用とGoogle写真一覧用で同じ番号）
    const okMedia = r.media.filter((m) => isPublishable(m) && m.alt);
    const fresh = okMedia.filter((m) => !m.card);
    const stems = fresh.length ? seoStems(r.facts, hp, okMedia.length, taken, HP_SUFFIXES) : [];
    for (const [i, m] of okMedia.entries()) {
      const needHp = !m.card;
      const needGbp = gbpOut && !(m.gbpPhoto && existsSync(m.gbpPhoto.file));
      if (!needHp && !needGbp) continue;                        // すでに作ってある（二重に作らない）
      const dir = join(photosDir, id);
      const file = existsSync(dir) && readdirSync(dir).find((f) => f.replace(/\.[^.]+$/, '') === m.id);
      if (!file) throw new Error(`写真 ${m.id} のコピーが受け渡し用フォルダにありません（${dir}）。`);
      browser = browser || await startBrowser();
      const stem = needHp ? stems[i] : (m.src.split('/').pop().replace(/\.jpg$/, ''));
      if (needHp) {
        const result = await processPhoto(browser, join(dir, file), RENDITIONS, m.crop || null, { masks: m.privacyMasks || [], tone: m.photoTone || null });
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
        if (usedW < 1200 || usedH < 900) m.qualityNote = `使った範囲が${usedW}×${usedH}pxのため、Google最新情報用（1200×900）は拡大されています。`;
      }
      if (needGbp) {
        // Google写真一覧用：切り抜かず高画質のコピー（リポジトリの外）
        const result = await processPhoto(browser, join(dir, file), [GBP_PHOTO_RENDITION], m.crop || null, { masks: m.privacyMasks || [], tone: m.photoTone || null });
        const x = result.renditions[0];
        const buf = Buffer.from(x.base64, 'base64');
        if (buf.length < GBP_PHOTO_LIMITS.minBytes || buf.length > GBP_PHOTO_LIMITS.maxBytes) throw new Error(`写真 ${m.id} の写真一覧用の画像が ${buf.length} バイトです（10KB以上5MB以下が必要）。`);
        if (Math.min(x.width, x.height) < GBP_PHOTO_LIMITS.minShortEdge) throw new Error(`写真 ${m.id} が小さすぎます（短い辺が${GBP_PHOTO_LIMITS.minShortEdge}px以上必要）。`);
        const outDir = join(resolve(gbpOut), id);
        mkdirSync(outDir, { recursive: true });
        const target = join(outDir, `${stem}.jpg`);
        if (existsSync(target)) throw new Error(`同じ名前のファイルがあります（上書きしません）：${target}`);
        writeFileSync(target, buf);
        m.gbpPhoto = { file: target, name: `${stem}.jpg`, width: x.width, height: x.height, bytes: buf.length };
      }
    }
    if (fingerprint(r, 'hp') !== fpBefore) throw new Error('画像を作ったことで承認の指紋が変わりました（処理を止めます）。');
    console.log(`○ ${id}：公開用の画像を用意しました（公開OKの写真${okMedia.length}枚${gbpOut ? '・Google写真一覧用を含む' : ''}）`);
  } catch (e) {
    failed = true;
    c.prepareError = e.message;
    console.log(`× ${id}：${e.message}`);
  }
}
if (browser) browser.close();
writeFileSync(outFile, JSON.stringify({ ...input, candidates: input.candidates.filter((c) => !c.prepareError) }, null, 2));
process.exit(failed ? 1 : 0);

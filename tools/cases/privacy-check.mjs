// 写真のプライバシー確認を作るための道具（AI〔Claude Code〕が写真を見て判断するときに使う）
//   node tools/cases/privacy-check.mjs --photos <報告の写真のフォルダ（p1.jpg …）> --out <リポジトリの外のフォルダ> [--privacy <確認ファイル>] [--report <報告ID>]
//
// - 写真の向きを直し、0〜1 の目盛り（10%ごと）を重ねた確認用の画像（<id>-grid.jpg）を作る → 処理する範囲を決める
// - --privacy を付けると、処理した後の確認用の画像（<id>-after.jpg：記事用と同じ処理）も作り、処理した部分が読めないことを測る
// - 確認ファイルのひな形（SHA-256 入り）を表示する
// どれも確認用で、リポジトリの外にだけ書く。元の写真は変更しない。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { ROOT } from './lib.mjs';
import { startBrowser, processPhoto } from './browser.mjs';
import { loadPrivacy, privacyFor, verifyRedactions, qualityText, CHECK_ITEMS } from './privacy.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const photosDir = opt('--photos');
const outDir = opt('--out');
if (!photosDir || !outDir) { console.error('--photos と --out を指定してください。'); process.exit(1); }
const rel = relative(ROOT, resolve(outDir));
if (!rel.startsWith('..') && !isAbsolute(rel)) { console.error('--out はリポジトリの外にしてください。'); process.exit(1); }
mkdirSync(outDir, { recursive: true });
const files = readdirSync(photosDir).filter((f) => /^p\d+\.(jpe?g|png|heic|webp)$/i.test(f)).sort();
const privacy = opt('--privacy') ? loadPrivacy(opt('--privacy'), opt('--report')) : null;

const browser = await startBrowser();
const template = { reportId: opt('--report') || '', version: 1, checkedBy: 'AI（Claude Code）', checkedAt: new Date().toISOString(), photos: {} };
let failed = false;
try {
  for (const f of files) {
    const id = f.replace(/\.[^.]+$/, '');
    const buf = readFileSync(join(photosDir, f));
    const sha = createHash('sha256').update(buf).digest('hex');
    template.photos[id] = { sha256: sha, status: 'ok', checked: CHECK_ITEMS, crop: null, redact: [], rotate: 0, enhance: 'auto', note: '' };
    // 目盛り付きの確認用画像（向きを直して長い辺1600px）
    const grid = await browser.evaluate(`(async () => {
      const bin = atob(${JSON.stringify(buf.toString('base64'))});
      const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([u8]), { imageOrientation: 'from-image' });
      const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, c.width, c.height);
      x.lineWidth = 1; x.font = 'bold 18px sans-serif';
      for (let k = 1; k < 10; k++) {
        x.strokeStyle = k === 5 ? 'rgba(255,0,0,.9)' : 'rgba(255,255,0,.85)';
        x.beginPath(); x.moveTo(c.width * k / 10, 0); x.lineTo(c.width * k / 10, c.height); x.stroke();
        x.beginPath(); x.moveTo(0, c.height * k / 10); x.lineTo(c.width, c.height * k / 10); x.stroke();
        x.fillStyle = '#000'; x.fillRect(c.width * k / 10 + 2, 2, 34, 22); x.fillRect(2, c.height * k / 10 + 2, 34, 22);
        x.fillStyle = '#ff0'; x.fillText('.' + k, c.width * k / 10 + 6, 20); x.fillText('.' + k, 6, c.height * k / 10 + 20);
      }
      const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      const a = new Uint8Array(await b.arrayBuffer()); let t = ''; for (let i = 0; i < a.length; i += 0x8000) t += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
      return { w: bmp.width, h: bmp.height, b64: btoa(t) };
    })()`);
    writeFileSync(join(outDir, `${id}-grid.jpg`), Buffer.from(grid.b64, 'base64'));
    console.log(`${id}：${grid.w}×${grid.h}（向きを直した後）SHA-256 ${sha}  → ${join(outDir, `${id}-grid.jpg`)}`);
    if (privacy) {
      try {
        const pv = privacyFor(privacy, id, join(photosDir, f));
        const spec = [{ key: 'main', spec: { mode: 'fit', maxW: 1600, maxH: 1600 }, formats: [{ type: 'image/jpeg', quality: 0.85 }] }];
        const r = await processPhoto(browser, join(photosDir, f), spec, pv.crop, pv.redactions, pv.opts);
        verifyRedactions(id, r.renditions);
        writeFileSync(join(outDir, `${id}-after.jpg`), Buffer.from(r.renditions[0].base64, 'base64'));
        // 比べるための「処理も補正もしない」画像
        const plain = await processPhoto(browser, join(photosDir, f), spec, null, [], {});
        writeFileSync(join(outDir, `${id}-plain.jpg`), Buffer.from(plain.renditions[0].base64, 'base64'));
        const m = r.renditions[0].redacted.map((q) => `${q.method} ${q.edge.toFixed(2)}`).join('、');
        console.log(`   処理後：${join(outDir, `${id}-after.jpg`)}${m ? `（処理した部分の細かさ：${m}）` : '（塗りつぶし・ぼかしなし）'}`);
        console.log(`   画質の補正：${qualityText(r.quality)}${r.rotate ? `／傾き ${r.rotate}度` : ''}`);
      } catch (e) {
        failed = true;
        console.log(`   × ${e.message}`);
      }
    }
  }
} finally {
  browser.close();
}
if (!privacy) console.log('\n確認ファイルのひな形：\n' + JSON.stringify(template, null, 2));
process.exit(failed ? 1 : 0);

// テスト用の「元写真」を作る：node tools/cases/make-test-originals.mjs <出力フォルダ>
// HPで公開済みのスタッフ写真に、架空の撮影情報（位置情報・撮影機器・向き）を書き込んだコピーを作る。
// 出力フォルダはリポジトリの外を指定する（元写真はGitHubに置かない、の再現）。
// 位置情報は架空の値（北緯35度40分・東経139度45分）。お客様の情報は使わない。

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './lib.mjs';

// 架空の元写真の一覧（ファイル名 ← 元にする公開済み写真、向き）
export const TEST_ORIGINALS = [
  ['IMG_9001.jpg', 'uploads/iphone-careful-disassembly-hands.jpg', 1],
  ['IMG_9002.jpg', 'uploads/staff-standing-smartphone-repair.jpg', 1],
  ['IMG_9003.jpg', 'uploads/staff-sim-card-smartphone.jpg', 1],
  ['IMG_9004.jpg', 'uploads/staff-nintendo-switch.jpg', 1],
  ['IMG_9005.jpg', 'uploads/staff-repair-working-together.jpg', 1],
  ['IMG_9006.jpg', 'uploads/two-staff-repair-counter.jpg', 1],
  // 向きの情報（回転）だけが付いた写真：横長の画像に「90度回して表示」の印を付ける
  ['IMG_9101_rotated.jpg', 'uploads/staff-nintendo-switch.jpg', 6]
];

function exifSegment(orientation) {
  // TIFF（リトルエンディアン）：IFD0 に Make・Orientation・GPS情報へのリンク、GPS IFD に緯度経度
  const entries0 = 3;
  const ifd0 = 8;
  const ifd0Size = 2 + entries0 * 12 + 4;
  const makeOff = ifd0 + ifd0Size; // "TestCam\0"（8バイト）
  const gpsIfd = makeOff + 8;
  const gpsEntries = 4;
  const gpsSize = 2 + gpsEntries * 12 + 4;
  const latOff = gpsIfd + gpsSize;
  const lonOff = latOff + 24;
  const t = Buffer.alloc(lonOff + 24);
  t.write('II', 0, 'ascii'); t.writeUInt16LE(42, 2); t.writeUInt32LE(ifd0, 4);
  let p = ifd0;
  t.writeUInt16LE(entries0, p); p += 2;
  const entry = (tag, type, count, value) => { t.writeUInt16LE(tag, p); t.writeUInt16LE(type, p + 2); t.writeUInt32LE(count, p + 4); t.writeUInt32LE(value, p + 8); p += 12; };
  entry(0x010f, 2, 8, makeOff);           // Make（撮影機器）
  entry(0x0112, 3, 1, orientation);       // Orientation（向き）
  entry(0x8825, 4, 1, gpsIfd);            // GPS情報
  t.writeUInt32LE(0, p);
  t.write('TestCam\0', makeOff, 'ascii');
  p = gpsIfd;
  t.writeUInt16LE(gpsEntries, p); p += 2;
  entry(0x0001, 2, 2, 0x4e);              // 北緯（'N'）
  entry(0x0002, 5, 3, latOff);
  entry(0x0003, 2, 2, 0x45);              // 東経（'E'）
  entry(0x0004, 5, 3, lonOff);
  t.writeUInt32LE(0, p);
  const rational = (off, vals) => vals.forEach((v, i) => { t.writeUInt32LE(v, off + i * 8); t.writeUInt32LE(1, off + i * 8 + 4); });
  rational(latOff, [35, 40, 0]);
  rational(lonOff, [139, 45, 0]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

export function makeOriginal(srcRel, outFile, orientation) {
  const src = readFileSync(join(ROOT, srcRel));
  if (src[0] !== 0xff || src[1] !== 0xd8) throw new Error(`JPEGではありません：${srcRel}`);
  writeFileSync(outFile, Buffer.concat([src.subarray(0, 2), exifSegment(orientation), src.subarray(2)]));
}

export function makeAll(dir) {
  const out = resolve(dir);
  if (out.startsWith(resolve(ROOT))) throw new Error('元写真のフォルダはリポジトリの外にしてください（GitHubに置かないため）。');
  mkdirSync(out, { recursive: true });
  for (const [name, src, orientation] of TEST_ORIGINALS) makeOriginal(src, join(out, name), orientation);
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('make-test-originals.mjs')) {
  const dir = process.argv[2];
  if (!dir) { console.error('出力フォルダを指定してください。'); process.exit(1); }
  console.log(`テスト用の元写真を作りました：${makeAll(dir)}`);
}

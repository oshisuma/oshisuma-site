// 段階②：写真の判定・ファイル名・alt・使い分け・撮影情報の確認（Node側の処理）
// 画像そのものの縮小・切り抜き・書き出しは photo-process.js（ブラウザ）で行う。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { ROOT } from './lib.mjs';

export const MIN_PHOTOS = 2;
export const MAX_PHOTOS = 5;

// 公開用に作る画像の種類（HP記事用・一覧用・Google投稿用）
export const RENDITIONS = [
  { key: 'main', spec: { mode: 'fit', maxW: 900, maxH: 1250 }, formats: [{ type: 'image/jpeg', quality: 0.82 }, { type: 'image/webp', quality: 0.8 }] },
  { key: 'card', spec: { mode: 'cover', w: 800, h: 600 }, formats: [{ type: 'image/jpeg', quality: 0.8 }, { type: 'image/webp', quality: 0.78 }] },
  { key: 'gbp', spec: { mode: 'cover', w: 1200, h: 900 }, formats: [{ type: 'image/jpeg', quality: 0.85 }] }
];
// 重さの上限（バイト）。Google投稿の写真は 10KB以上5MB以下
export const SIZE_LIMITS = {
  'main.jpg': 300 * 1024, 'main.webp': 250 * 1024,
  'card.jpg': 150 * 1024, 'card.webp': 120 * 1024,
  'gbp.jpg': 5 * 1024 * 1024
};
export const GBP_MIN_BYTES = 10 * 1024;

// 地域名（市町村）→ ファイル名に使うローマ字。ここにない地域はファイル名に入れない（推測しない）
export const AREA_SLUGS = {
  '水戸市': 'mito', '茨城町': 'ibarakimachi', '大洗町': 'oarai', 'ひたちなか市': 'hitachinaka',
  '鉾田市': 'hokota', '笠間市': 'kasama', '小美玉市': 'omitama', '那珂市': 'naka', '城里町': 'shirosato',
  '石岡市': 'ishioka', '行方市': 'namegata', '東海村': 'tokai', '日立市': 'hitachi',
  '常陸大宮市': 'hitachiomiya', '筑西市': 'chikusei', '土浦市': 'tsuchiura', 'つくば市': 'tsukuba'
};
// 修理内容 → ファイル名に使う英語。ここにない修理内容は止めて、対応表への追加を求める
export const WORK_SLUGS = {
  '画面修理': 'screen-repair', '画面交換': 'screen-repair', 'バッテリー交換': 'battery-replacement',
  '充電口修理': 'charging-port-repair', '充電口交換': 'charging-port-repair', 'カメラ修理': 'camera-repair',
  '背面ガラス修理': 'back-glass-repair', '水没修理': 'water-damage-repair', 'データ移行': 'data-transfer',
  'Joy-Conスティック交換': 'joycon-stick-replacement', 'スピーカー修理': 'speaker-repair',
  'ボタン修理': 'button-repair', '基板修理': 'board-repair'
};
export const DEVICE_CATEGORIES = ['iphone', 'android', 'ipad', 'switch', 'other'];
const CATEGORY_LABELS = { iphone: 'iPhone', android: 'Android', ipad: 'iPad', switch: 'Switch', other: 'その他の物' };

// 写真に写っていると公開できない（人の確認が必要な）もの
export const RISK_LABELS = {
  face: '人物の顔', person: '人物（顔の有無が不確か）', screen: '端末の画面に表示された内容',
  document: '伝票・書類', barcode: 'バーコード・QRコード', idcard: '身分証・カード類',
  handwriting: '手書きの文字（管理番号・名前など）', price: '料金の表示', address: '住所・ナンバープレート'
};
const SHOW_ORDER = { hp: ['before', 'during', 'after', 'part'], gbp: ['during', 'after', 'before', 'part'] };

// ---------------------------------------------------------------- 判定

// review … 写真を見た結果（将来はAI、今は人やテスト用の入力）。ない・自信が低いときは必ず「確認待ち」
export function assessPhoto(review, facts) {
  const reasons = [];
  let privacyCheck = 'ok';
  let contentMatch = 'ok';
  if (!review) {
    return { privacyCheck: 'pending', contentMatch: 'pending', reasons: ['写真の内容をまだ確認していません（AIまたは人の確認待ち）。'] };
  }
  if (review.confidence !== 'high') { privacyCheck = 'pending'; contentMatch = 'pending'; reasons.push('判定に自信がないため、人の確認が必要です。'); }
  if (!['none', 'hands'].includes(review.people)) {
    privacyCheck = 'pending';
    reasons.push(review.people === 'face' ? '人物の顔が写っています。' : '人物が写っている可能性があります。');
  }
  for (const r of review.risks || []) {
    privacyCheck = 'pending';
    reasons.push(`${RISK_LABELS[r] || r}が写っています。`);
  }
  if (review.device !== facts.device.category) {
    contentMatch = 'mismatch';
    reasons.push(`写真に写っているもの（${CATEGORY_LABELS[review.device] || '不明'}）が報告の機種（${facts.device.name}）と合いません。`);
  }
  if (!SHOW_ORDER.hp.includes(review.shows)) {
    contentMatch = contentMatch === 'ok' ? 'mismatch' : contentMatch;
    reasons.push('修理の前後・作業・部品の写真ではありません。');
  }
  return { privacyCheck, contentMatch, reasons };
}

export const isPublishable = (m) => m.privacyCheck === 'ok' && m.contentMatch === 'ok';

// 日本語のalt。写真の説明（review.description）を使い、機種名がなければ補う。説明がなければ仮のaltにして確認待ち
export function makeAlt(review, facts, index) {
  const device = facts.device.name;
  if (!review || !review.description) return `${device}の${facts.works[0]}（写真${index + 1}）`;
  const d = review.description.trim().replace(/[。.]$/, '');
  return d.includes(device) ? d : `${device}：${d}`;
}

// 媒体ごとの写真の選び方：公開できる写真の中から、HPは「修理前→作業中→修理後」、Googleは「作業中→修理後→修理前」の順で選ぶ
export function chooseMedia(media, channel) {
  const ok = media.filter(isPublishable);
  for (const shows of SHOW_ORDER[channel]) {
    const m = ok.find((x) => x.shows === shows);
    if (m) return m.id;
  }
  return null;
}

// ---------------------------------------------------------------- ファイル名

export function baseName(facts) {
  const parts = [];
  const area = facts.area && AREA_SLUGS[facts.area.name];
  if (area) parts.push(area);
  const device = facts.device.slug;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(device || '')) throw new Error(`機種のファイル名用の表記（device.slug）が正しくありません：${device}`);
  parts.push(device);
  const work = WORK_SLUGS[facts.works[0]];
  if (!work) throw new Error(`修理内容「${facts.works[0]}」がファイル名の対応表（WORK_SLUGS）にありません。対応表に追加してください。`);
  parts.push(work);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(facts.workDate || '')) throw new Error('作業日（facts.workDate）がありません。');
  parts.push(facts.workDate.replace(/-/g, ''));
  const name = parts.join('-');
  if (name.length > 60) throw new Error(`ファイル名が長すぎます（${name.length}文字）：${name}`);
  return name;
}

// リポジトリ内にある画像のファイル名（小文字）。新しい名前がこれと重なったら番号を付ける
export function existingImageNames(root = ROOT) {
  const names = new Set();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jpe?g|png|webp|gif|avif|svg)$/i.test(e.name)) names.add(e.name.toLowerCase());
    }
  };
  walk(root);
  return names;
}

// 写真1枚分の名前（拡張子・-card・-gbp を付ける前）。taken … すでに使われている名前
export function uniqueStem(base, n, taken) {
  let i = n;
  for (;;) {
    const stem = i === 1 ? base : `${base}-${i}`;
    const files = [`${stem}.jpg`, `${stem}.webp`, `${stem}-card.jpg`, `${stem}-card.webp`, `${stem}-gbp.jpg`];
    if (!files.some((f) => taken.has(f))) { files.forEach((f) => taken.add(f)); return stem; }
    i++;
  }
}

export const FILE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*\.(jpg|webp)$/;

// ---------------------------------------------------------------- 撮影情報（メタデータ）の確認

// 画像に残っている撮影情報を調べる。gps … 位置情報、exif … 撮影情報全般、xmp … 編集情報など
export function scanMetadata(buf) {
  const found = { exif: false, gps: false, xmp: false, other: [] };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 4 <= buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      if (marker === 0xda) break; // 画像データの始まり
      const len = buf.readUInt16BE(i + 2);
      const seg = buf.subarray(i + 4, i + 2 + len);
      if (marker === 0xe1 && seg.toString('latin1', 0, 4) === 'Exif') {
        found.exif = true;
        if (hasGpsIfd(seg.subarray(6))) found.gps = true;
      } else if (marker === 0xe1 && seg.toString('latin1').includes('http://ns.adobe.com/xap/')) {
        found.xmp = true;
      } else if (marker === 0xed) {
        found.other.push('IPTC');
      } else if (marker === 0xfe) {
        found.other.push('コメント');
      }
      i += 2 + len;
    }
  } else if (buf.toString('ascii', 0, 4) === 'RIFF') {
    for (let i = 12; i + 8 <= buf.length;) {
      const id = buf.toString('ascii', i, i + 4);
      const size = buf.readUInt32LE(i + 4);
      if (id === 'EXIF') { found.exif = true; if (hasGpsIfd(buf.subarray(i + 8, i + 8 + size))) found.gps = true; }
      if (id === 'XMP ') found.xmp = true;
      i += 8 + size + (size % 2);
    }
  }
  return found;
}

function hasGpsIfd(tiff) {
  if (tiff.length < 8) return false;
  const le = tiff.toString('ascii', 0, 2) === 'II';
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return false;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > tiff.length) break;
    if (u16(e) === 0x8825) return true;
  }
  return false;
}

export function readImage(src, root = ROOT) {
  const file = join(root, src.replace(/^\//, ''));
  return existsSync(file) ? readFileSync(file) : null;
}

export { basename };

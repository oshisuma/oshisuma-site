// 写真のプライバシー処理（公開用のコピーだけを加工する。元の写真は変更しない）
//
// 「写真のプライバシー確認」ファイル（報告1件につき1つ。AI〔Claude Code〕が写真を見て作る）
// {
//   "reportId": "R-…", "version": 1, "checkedBy": "AI（Claude Code）", "checkedAt": "…",
//   "photos": {
//     "p1": {
//       "sha256": "元の写真の SHA-256（この写真を見て決めたことの確認）",
//       "status": "ok" | "processed" | "unsafe",   // ok＝処理不要／processed＝処理して公開／unsafe＝安全に処理できないので公開しない
//       "checked": ["顔", "名前・住所", "書類", "QRコード・バーコード", "シリアル・IMEI・管理番号", "端末の画面", "背景"],
//       "crop": { "x": 0, "y": 0, "w": 1, "h": 1 } | null,          // 必要な部分だけを使う（0〜1・写真の向きを直した後）
//       "redact": [{ "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1, "method": "fill" | "blur", "reason": "背景の書類" }],
//       "note": "判断のメモ（個人情報そのものは書かない）"
//     }
//   }
// }
//
// 守ること
// - 公開する写真は、すべて確認済みであること（確認がない写真は公開しない）
// - 確認した写真と、公開しようとしている写真が同じこと（SHA-256）
// - unsafe の写真は公開しない
// - 処理した部分は、できあがった公開用の画像を読み直して、細かい模様（文字・線）が残っていないことを確かめる
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const CHECK_ITEMS = ['顔', '名前・住所', '書類', 'QRコード・バーコード', 'シリアル・IMEI・管理番号', '端末の画面', '背景'];
// 処理した部分の「細かさ」の上限（となりの点との明るさの差の平均）。文字や線が残っていると 3〜15 程度になる
export const MAX_REDACTED_EDGE = 1.5;

const inUnit = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const rectOk = (r) => r && inUnit(r.x) && inUnit(r.y) && inUnit(r.w) && inUnit(r.h) && r.w > 0 && r.h > 0 && r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001;

export function loadPrivacy(file, reportId) {
  const p = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const bad = (m) => { throw new Error(`写真のプライバシー確認ファイルが正しくありません：${m}`); };
  if (p.version !== 1 || !p.photos || typeof p.photos !== 'object') bad('形式');
  if (reportId && p.reportId !== reportId) bad(`報告ID（${p.reportId}）がこの報告（${reportId}）と違います`);
  for (const [id, e] of Object.entries(p.photos)) {
    if (!/^[0-9a-f]{64}$/.test(e.sha256 || '')) bad(`${id} の SHA-256`);
    if (!['ok', 'processed', 'unsafe'].includes(e.status)) bad(`${id} の status`);
    if (!Array.isArray(e.checked) || CHECK_ITEMS.some((k) => !e.checked.includes(k))) bad(`${id} の確認項目（${CHECK_ITEMS.join('・')} をすべて確認する）`);
    if (e.crop != null && !rectOk(e.crop)) bad(`${id} の切り抜きの範囲`);
    for (const r of e.redact || []) {
      if (!rectOk(r) || !['fill', 'blur'].includes(r.method) || !r.reason) bad(`${id} の処理の範囲・方法・理由`);
    }
    if (e.status === 'processed' && !(e.redact || []).length && !e.crop) bad(`${id} は「処理して公開」なのに、処理の内容がありません`);
    if (e.status === 'ok' && ((e.redact || []).length || e.crop)) bad(`${id} は「処理不要」なのに、処理の内容があります`);
  }
  return p;
}

// 1枚の写真の処理内容を返す。公開してはいけない写真なら止める
export function privacyFor(privacy, id, file) {
  const e = privacy.photos[id];
  if (!e) throw new Error(`写真 ${id} のプライバシー確認がありません（確認していない写真は公開しません）。`);
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (sha !== e.sha256) throw new Error(`写真 ${id} が、プライバシー確認をした写真と違います（SHA-256 が一致しません）。`);
  if (e.status === 'unsafe') throw new Error(`写真 ${id} は、個人情報を安全に処理できないため公開しません（${e.note || '理由はプライバシー確認ファイルを参照'}）。`);
  return { crop: e.crop || null, redactions: (e.redact || []).map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, method: r.method })) };
}

// できあがった公開用の画像の確認結果（processPhoto の renditions[].redacted）を調べる
export function verifyRedactions(id, renditions) {
  const problems = [];
  for (const r of renditions) {
    if (r.unsupported) continue;
    for (const q of r.redacted || []) {
      if (!(q.pixels > 0)) continue;   // 小さすぎて測れない（切り抜きのふちなど）
      if (q.edge > MAX_REDACTED_EDGE) problems.push(`${r.key}（${r.type}）の処理した部分に細かい模様が残っています（${q.edge.toFixed(2)}）`);
    }
  }
  if (problems.length) throw new Error(`写真 ${id}：${problems.join('／')}。公開しません。`);
}

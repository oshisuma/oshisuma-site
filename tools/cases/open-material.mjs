// 材料セット（承認画面の「材料と写真を1つのファイルにまとめる」でダウンロードしたファイル）を開く
//   node tools/cases/open-material.mjs [--set <…-material.json>] [--out <作業フォルダ（リポジトリの外）>] [--check]
//
//   --set 省略時 … このパソコンの「ダウンロード」フォルダで、いちばん新しい …-material.json を使う
//   --check     … 写真のプライバシー確認用の画像（目盛り付き）も作る（privacy-check.mjs）
//
// - 写真ごとに SHA-256 を確かめ、壊れた写真・すり替わった写真は使わない
// - 材料（material.json）と写真（photos/p1.jpg …）を、リポジトリの外の作業フォルダに書き出す（元のファイルはそのまま）
// - 材料セットは公開しない（下書きの作成と、写真の確認・処理に使う）
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib.mjs';

export function newestMaterial(dir = join(homedir(), 'Downloads')) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /-material(\s*\(\d+\))?\.json$/i.test(f)).map((f) => join(dir, f));
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] || null;
}

// 材料セットを読み、写真を確かめる（読むだけ）
export function readMaterial(file) {
  const s = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (s.materialVersion !== 1 || !s.material || !Array.isArray(s.photos)) throw new Error('材料セットの形式が正しくありません（承認画面の「材料セットをダウンロード」のファイルを使ってください）。');
  const id = s.material.reportId;
  if (!/^R-[0-9]{8}-[0-9a-z]+$/i.test(id || '')) throw new Error('材料セットの報告IDが正しくありません。');
  const ids = (s.material.photos || []);
  const got = s.photos.map((p) => p.id);
  if (ids.length !== got.length || ids.some((x) => !got.includes(x))) throw new Error(`材料セットの写真がそろっていません（報告 ${ids.join('・')}／ファイル ${got.join('・')}）。`);
  const photos = s.photos.map((p) => {
    if (p.reportId !== id) throw new Error(`写真 ${p.id} が別の報告のものです。`);
    if (!new RegExp(`^${p.id}\\.(jpe?g|png|heic|webp)$`, 'i').test(p.name || '')) throw new Error(`写真 ${p.id} のファイル名が正しくありません。`);
    const buf = Buffer.from(p.base64 || '', 'base64');
    if (buf.length !== p.bytes) throw new Error(`写真 ${p.id} が途中で切れています。`);
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== p.sha256) throw new Error(`写真 ${p.id} が承認画面で作ったものと違います（SHA-256 が一致しません）。`);
    return { id: p.id, name: p.name, buf, sha256: sha, mimeType: p.mimeType };
  });
  return { material: s.material, exportedAt: s.exportedAt, photos };
}

export function main(argv) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const file = opt('--set') ? resolve(opt('--set')) : newestMaterial();
  if (!file || !existsSync(file)) throw new Error('材料セットが見つかりません。承認画面の「材料セットをダウンロード」でダウンロードしてください。');
  const m = readMaterial(file);
  const id = m.material.reportId;
  const out = resolve(opt('--out') || join(homedir(), 'oshisuma-case-work', `${id}-material`));
  const rel = relative(ROOT, out);
  if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('作業フォルダはリポジトリの外にしてください。');
  mkdirSync(join(out, 'photos'), { recursive: true });
  for (const p of m.photos) {
    const target = join(out, 'photos', p.name);
    if (existsSync(target) && createHash('sha256').update(readFileSync(target)).digest('hex') !== p.sha256) throw new Error(`作業フォルダに別の ${p.name} があります（上書きしません）：${target}`);
    writeFileSync(target, p.buf);
  }
  writeFileSync(join(out, 'material.json'), JSON.stringify({ ...m.material, photoSha256: Object.fromEntries(m.photos.map((p) => [p.id, p.sha256])), exportedAt: m.exportedAt }, null, 2));
  console.log(`○ 材料セット：${file}`);
  console.log(`  報告ID ${id}／地域 ${m.material.area || 'なし'}／機種 ${m.material.device}／写真 ${m.photos.map((p) => p.id).join('・')}（壊れていない）`);
  console.log(`  作業フォルダ：${out}`);
  if (argv.includes('--check')) {
    execFileSync(process.execPath, [join(ROOT, 'tools/cases/privacy-check.mjs'), '--photos', join(out, 'photos'), '--out', join(out, 'check'), '--report', id], { stdio: 'inherit' });
  }
  return { out, id, material: m.material };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`× 止めました：${e.message}`); process.exit(1); }
}

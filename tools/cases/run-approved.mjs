// 公開セット（承認画面が作る1ファイル）から、HPのプレビューまでを1回で行う
//   node tools/cases/run-approved.mjs [--set <公開セット（…-set.json）>] [--push] [--work <作業フォルダ>] [--no-git]
//
//   --set 省略時 … このパソコンの「ダウンロード」フォルダで、いちばん新しい …-set.json を使う
//   --push      … 作業用ブランチを GitHub に送り、Cloudflare のプレビューができるまで待って URL を表示する
//                 （送らないときは、このパソコンの作業用ブランチに記録するところまで）
//   --no-git    … ブランチを作らず、今のフォルダに公開用ファイルを作るだけ（テスト用）
//
// 流れ：公開セットの確認 → 作業用ブランチ（main から）→ 公開用の画像 → 記事・一覧・サイトマップ → テストデータの確認
//       → 変わったファイルの確認 → 記録（コミット）→（--push）プレビュー
//
// 守ること
// - main には書き込まない・送らない。本番への公開は、オーナーがプレビューを確認して承認した後、別に行う
// - 承認した時点から内容が変わっていたら止める（HP記事・Google最新情報・Google写真一覧の指紋）
// - 写真は「公開OK」のものだけ。運ぶ途中で壊れた・すり替わった写真（SHA-256 が違う）は使わない
// - 同じ内容で公開済みなら何もしない。テストデータは本番用に作らない
// - 途中で問題があれば、そこで止めて理由を表示する（作ったファイルは消さずに残す）
// - 写真一覧用の画像・作業用のファイルはリポジトリの外（--work）に置く

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, SITE, CASES_URL, fingerprint, hpTitle } from './lib.mjs';
import { isPublishable } from './photos.mjs';

export const PAGES_PROJECT = 'oshisuma-site';

// Cloudflare Pages のブランチ用プレビューの名前（英小文字・数字以外はハイフン、28文字まで、末尾のハイフンは除く）
export function previewAlias(branch) {
  return branch.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 28).replace(/-+$/, '');
}
export function previewBase(branch) {
  return `https://${previewAlias(branch)}.${PAGES_PROJECT}.pages.dev`;
}
// 作業用ブランチの名前：報告IDの末尾（英数字）＋版。プレビューの名前が報告ごとに別になるようにする
export function branchName(c) {
  const tail = String(c.reportId).split('-').pop().toLowerCase();
  if (!/^[a-z0-9]{4,}$/.test(tail)) throw new Error(`報告ID「${c.reportId}」から作業用ブランチの名前を作れません。`);
  return `work/case-${tail}-v${Number(c.revision)}`;
}

// ダウンロードフォルダで、いちばん新しい公開セット（ブラウザが付ける「 (1)」などにも対応）
export function newestSet(dir = join(homedir(), 'Downloads')) {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /-set(\s*\(\d+\))?\.json$/i.test(f)).map((f) => join(dir, f));
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0] || null;
}

// 公開セットを読み、承認と写真を確かめる（読むだけ）
export function readSet(file) {
  const s = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (s.exportVersion !== 1 || s.setVersion !== 1 || !Array.isArray(s.candidates) || !Array.isArray(s.photos)) throw new Error('公開セットの形式が正しくありません（承認画面の「公開セットをダウンロード」のファイルを使ってください）。');
  if (s.candidates.length !== 1) throw new Error('公開セットには、報告が1件だけ入っている必要があります。');
  const c = s.candidates[0];
  const r = c.report;
  if (!r || r.reportId !== c.reportId || !r.drafts || !r.drafts.hp) throw new Error('公開セットの報告データが正しくありません。');
  // 承認：HP記事は必須。Google最新情報・写真一覧は、承認済みなら内容が変わっていないこと
  const a = c.approval || {};
  if (!a.hp || a.hp.state !== 'approved') throw new Error('HP記事が承認済みではありません。');
  if (a.hp.fp !== fingerprint(r, 'hp')) throw new Error('HP記事が、承認した後に変わっています（承認画面で承認し直してください）。');
  for (const ch of ['gbp', 'gbpPhotos']) {
    if (a[ch] && a[ch].state === 'approved' && a[ch].fp !== fingerprint(r, ch)) throw new Error(`${ch === 'gbp' ? 'Google最新情報' : 'Google写真一覧'}が、承認した後に変わっています。`);
  }
  // 写真：「公開OK」の写真がちょうど全部入っていて、壊れていない
  const okIds = r.media.filter((m) => isPublishable(m) && m.alt).map((m) => m.id);
  const got = s.photos.map((p) => p.id);
  const missing = okIds.filter((id) => !got.includes(id));
  const extra = got.filter((id) => !okIds.includes(id));
  if (missing.length) throw new Error(`「公開OK」の写真 ${missing.join('・')} が公開セットに入っていません。`);
  if (extra.length) throw new Error(`「公開OK」ではない写真 ${extra.join('・')} が公開セットに入っています（使いません）。`);
  if (new Set(got).size !== got.length) throw new Error('同じ写真が2つ入っています。');
  const photos = s.photos.map((p) => {
    if (p.reportId !== c.reportId) throw new Error(`写真 ${p.id} が別の報告のものです。`);
    if (!new RegExp(`^${p.id}\\.(jpe?g|png|heic|webp)$`, 'i').test(p.name || '')) throw new Error(`写真 ${p.id} のファイル名が正しくありません。`);
    const buf = Buffer.from(p.base64 || '', 'base64');
    if (buf.length !== p.bytes) throw new Error(`写真 ${p.id} が途中で切れています（${buf.length}／${p.bytes}バイト）。`);
    if (createHash('sha256').update(buf).digest('hex') !== p.sha256) throw new Error(`写真 ${p.id} が承認画面で作ったものと違います（SHA-256 が一致しません）。`);
    return { id: p.id, name: p.name, buf };
  });
  return { set: s, candidate: c, photos };
}

// ---------------------------------------------------------------- 実行
const gitRaw = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (args) => gitRaw(args).trim();
const node = (script, args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [join(ROOT, 'tools/cases', script), ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status || 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};
const stamp = () => new Date(Date.now() + 9 * 3600000).toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
class Stop extends Error {}
const stop = (msg) => { throw new Stop(msg); };

async function waitPreview(url, mark, minutes = 10) {
  const until = Date.now() + minutes * 60000;
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      // 見つからないページでもトップページが返ることがあるため、記事の中身（URLの記載）で確かめる
      if (res.ok && (await res.text()).includes(mark)) return true;
    } catch { /* まだできていない */ }
    await new Promise((r) => setTimeout(r, 15000));
  }
  return false;
}

export async function main(argv) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const useGit = !argv.includes('--no-git');
  const push = argv.includes('--push');
  if (push && !useGit) stop('--push と --no-git は一緒に使えません。');
  const step = (s) => console.log(`\n■ ${s}`);

  step('1. 公開セットの確認');
  const setFile = opt('--set') ? resolve(opt('--set')) : newestSet();
  if (!setFile || !existsSync(setFile)) stop('公開セットが見つかりません。承認画面の「公開セットをダウンロード」でダウンロードしてください。');
  console.log(`  ファイル：${setFile}`);
  let read;
  try { read = readSet(setFile); } catch (e) { stop(e.message); }
  const { candidate: c, photos } = read;
  const r = c.report;
  const id = c.reportId;
  const hp = r.drafts.hp;
  const isTest = r.status === 'test' || (r.source && r.source.type === 'test');
  if (isTest) stop('テストデータは本番用に作りません。');
  if (hp.date !== hp.slug.slice(0, 10)) stop(`掲載日（${hp.date}）と記事のURLの日付（${hp.slug.slice(0, 10)}）が違います。`);
  const recFile = join(ROOT, 'content/case-reports/published', `${id}.json`);
  if (existsSync(recFile)) {
    const before = JSON.parse(readFileSync(recFile, 'utf8'));
    if (before.publishLog && before.publishLog.hp && before.publishLog.hp.fp === c.approval.hp.fp) stop('この内容はすでに公開済みです（何もしません）。');
  }
  const title = hpTitle(hp);
  console.log(`  ○ ${title}（報告ID ${id}・版${c.revision}）`);
  console.log(`  ○ 承認：HP記事 承認済み／Google最新情報 ${c.approval.gbp ? c.approval.gbp.state : '-'}／Google写真一覧 ${c.approval.gbpPhotos ? c.approval.gbpPhotos.state : '-'}（承認後の変更なし）`);
  console.log(`  ○ 写真：公開OKの ${photos.map((p) => p.id).join('・')}（${photos.length}枚・壊れていない）`);
  console.log(`  ○ 掲載日：${hp.date}　記事のURL：${SITE}${CASES_URL}${hp.slug}/`);

  let branch = null;
  if (useGit) {
    step('2. 作業用ブランチ（main から作る）');
    if (git(['status', '--porcelain'])) stop('HPのフォルダに、記録していない変更があります。先に片付けてから実行してください。');
    git(['fetch', 'origin', '--quiet']);
    branch = branchName(c);
    if (git(['branch', '--list', branch]) || git(['ls-remote', '--heads', 'origin', branch])) stop(`作業用ブランチ ${branch} はすでにあります（同じ版を二度作りません）。`);
    git(['switch', '--no-track', '-c', branch, 'origin/main']);
    console.log(`  ○ ${branch}（${git(['log', '-1', '--format=%h %s'])} から）`);
  }

  step(`${useGit ? 3 : 2}. 公開用の画像を作る`);
  const work = resolve(opt('--work') || join(homedir(), 'oshisuma-case-work', `${id}-v${c.revision}-${stamp()}`));
  const rel = relative(ROOT, work);
  if (!rel.startsWith('..') && !isAbsolute(rel)) stop('作業フォルダはリポジトリの外にしてください。');
  if (existsSync(work) && readdirSync(work).length) stop(`作業フォルダ ${work} が空ではありません。`);
  mkdirSync(join(work, 'photos', id), { recursive: true });
  for (const p of photos) writeFileSync(join(work, 'photos', id, p.name), p.buf);
  const candFile = join(work, 'candidates.json');
  writeFileSync(candFile, JSON.stringify({ exportVersion: 1, exportedAt: read.set.exportedAt, candidates: [c] }, null, 2));
  const prepared = join(work, 'prepared.json');
  let res = node('prepare-approved.mjs', ['--candidates', candFile, '--photos', join(work, 'photos'), '--out', prepared, '--gbp-out', join(work, 'gbp-photos')]);
  console.log(res.out.trim().replace(/^/gm, '  '));
  if (res.code !== 0) stop('公開用の画像を作れませんでした。');

  step(`${useGit ? 4 : 3}. 記事・一覧のカード・サイトマップを作る`);
  res = node('publish.mjs', ['--candidates', prepared, '--mode', 'production']);
  console.log(res.out.trim().replace(/^/gm, '  '));
  if (res.code !== 0 || !/○ (公開用に作成|新しい版に更新)：/.test(res.out)) stop('記事を作れませんでした（上の理由を確認してください）。');
  const notes = JSON.parse(readFileSync(prepared, 'utf8')).candidates[0].report.media.filter((m) => m.qualityNote).map((m) => `写真 ${m.id}：${m.qualityNote}`);

  if (!useGit) {
    console.log(`\n○ 完了（ブランチ・記録なし）：${title}\n  作業フォルダ：${work}`);
    return { work, title, slug: hp.slug, notes };
  }

  step('5. 変わったファイルとテストデータの確認');
  // 先頭の2文字は状態（例「 M」「??」）。trim すると1行目がずれるため、そのまま読む
  const changed = gitRaw(['status', '--porcelain', '-uall']).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''));
  const allowed = (f) => f === `repair/cases/${hp.slug}/index.html` || f === 'repair/cases/index.html' || f === 'sitemap.xml' ||
    f === `content/case-reports/published/${id}.json` || f === 'content/case-reports/_logs/publish.jsonl' || /^repair\/cases\/images\/[a-z0-9-]+\.(jpg|webp)$/.test(f);
  const odd = changed.filter((f) => !allowed(f));
  if (odd.length) stop(`予定外のファイルが変わっています（記録しません）：${odd.join('、')}`);
  git(['add', '--', ...changed]);
  res = node('check-no-test-data.mjs', []);
  console.log(res.out.trim().replace(/^/gm, '  '));
  if (res.code !== 0) stop('テスト用のものが混ざっています（記録しません）。');
  changed.forEach((f) => console.log(`  ・${f}`));

  step('6. 作業用ブランチに記録');
  if (git(['rev-parse', '--abbrev-ref', 'HEAD']) !== branch || !branch.startsWith('work/case-')) stop('作業用ブランチではありません（記録しません）。');
  git(['commit', '-q', '-m', `修理事例を追加（プレビュー用）：${title}\n\n報告ID ${id}・版${c.revision}・HP記事の承認 ${c.approval.hp.fp}`]);
  console.log(`  ○ ${git(['log', '-1', '--format=%h %s'])}`);

  const base = previewBase(branch);
  const articleUrl = `${base}${CASES_URL}${hp.slug}/`;
  if (push) {
    step('7. GitHub の作業用ブランチへ送り、プレビューを待つ（main には送りません）');
    git(['push', '--quiet', 'origin', `${branch}:refs/heads/${branch}`]);
    const ok = await waitPreview(articleUrl, `${SITE}${CASES_URL}${hp.slug}/`);
    console.log(ok ? '  ○ プレビューができました。' : '  △ 10分待ってもプレビューを確認できませんでした（少し待ってから開いてください）。');
  }
  console.log(`\n○ 完了：${title}`);
  console.log(`  記事のプレビュー：${articleUrl}${push ? '' : '（--push で送った後に見られます）'}`);
  console.log(`  一覧のプレビュー：${base}${CASES_URL}`);
  console.log(`  作業フォルダ（写真一覧用の画像など・リポジトリの外）：${work}`);
  notes.forEach((n) => console.log(`  ※ ${n}`));
  console.log('  まだ本番には公開していません。オーナーがプレビューを確認し、承認してから main に統合します。');
  return { work, title, slug: hp.slug, branch, articleUrl, notes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`\n× 止めました：${e.message}`);
    if (!(e instanceof Stop)) console.error(e.stack);
    process.exit(1);
  });
}

// 承認画面で承認された「公開セット」を見つけて、作業用ブランチ・プレビューまで自動で進める
//   node tools/cases/auto-approved.mjs --inbox <公開セットが届くフォルダ> [--push] [--state <記録ファイル>]
//
//   --inbox … 公開セット（…-set.json）が届くフォルダ（ダウンロード、または Googleドライブ パソコン版の approved フォルダ）
//   --push  … 作業用ブランチを GitHub に送り、Cloudflare のプレビューを作る（main には送らない）
//   --state … 処理した公開セットの記録（既定：リポジトリの外の ~/oshisuma-case-work/auto-approved-state.json）
//
// 写真の扱い（2026-11 オーナー決定）：AIは警告するだけで、写真は加工しない。オーナーが承認画面で「公開OK」にした写真だけを、
// サイズの変換と撮影情報の削除だけして使う（run-approved.mjs --owner-check）。
//
// 守ること
// - 本番（main）には何もしない。公開は、オーナーがプレビューを確認し、GitHubのレビュー（PR）で承認・統合したときだけ
// - 保留中の記事・承認後に内容が変わった記事・オーナーの「公開OK」がない写真・AIの警告を確認していない写真は止める（run-approved.mjs）
// - 同じ公開セット（中身が同じ）は二度処理しない。止まったものも自動ではやり直さない（承認し直すと新しい公開セットになる）
// - 処理のあとは、元のブランチに戻す
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib.mjs';
import { main as runApproved } from './run-approved.mjs';

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function setFiles(inbox) {
  if (!existsSync(inbox)) throw new Error(`公開セットのフォルダがありません：${inbox}`);
  return readdirSync(inbox).filter((f) => /-set(\s*\(\d+\))?\.json$/i.test(f)).map((f) => join(inbox, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);   // 古い順（承認した順）
}

export async function autoApproved(argv, deps = {}) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const inbox = opt('--inbox') ? resolve(opt('--inbox')) : null;
  if (!inbox) throw new Error('--inbox <公開セットが届くフォルダ> を指定してください。');
  const push = argv.includes('--push');
  const stateFile = resolve(opt('--state') || join(homedir(), 'oshisuma-case-work', 'auto-approved-state.json'));
  const run = deps.runApproved || runApproved;
  mkdirSync(dirname(stateFile), { recursive: true });

  // 同時に2つ動かない
  const lockFile = stateFile + '.lock';
  if (existsSync(lockFile) && Date.now() - statSync(lockFile).mtimeMs < 60 * 60000) {
    console.log('ほかの処理が動いているため、何もしません。');
    return [];
  }
  writeFileSync(lockFile, String(process.pid));
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { version: 1, sets: {} };
  const results = [];
  try {
    for (const file of setFiles(inbox)) {
      const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (state.sets[sha]) continue;                                   // 処理済み（成功・停止とも）
      const name = file.split(/[\\/]/).pop();
      console.log(`\n=== ${name}`);
      const startBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
      const rec = { file: name, at: new Date().toISOString() };
      try {
        const out = await run(['--set', file, '--owner-check', ...(push ? ['--push'] : [])]);
        Object.assign(rec, { result: 'preview', title: out.title, branch: out.branch, articleUrl: out.articleUrl, prUrl: out.prUrl, pushed: push });
      } catch (e) {
        Object.assign(rec, { result: /すでに公開済み/.test(e.message) ? 'already-published' : 'stopped', reason: e.message });
        console.log(`× 止めました：${e.message}`);
      } finally {
        // 元のブランチに戻す（記録していない変更が残っていれば、そのままにして知らせる）
        try {
          if (git(['rev-parse', '--abbrev-ref', 'HEAD']) !== startBranch) {
            if (git(['status', '--porcelain'])) rec.note = '作業用ブランチに記録していない変更が残っています（元のブランチに戻していません）。';
            else git(['switch', '--quiet', startBranch]);
          }
        } catch (e) { rec.note = 'ブランチを戻せませんでした：' + e.message; }
      }
      state.sets[sha] = rec;
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
      results.push(rec);
      if (rec.note) { console.log('※ ' + rec.note); break; }       // 片付くまで次へ進まない
    }
  } finally {
    try { unlinkSync(lockFile); } catch { /* なし */ }
  }
  if (!results.length) console.log('新しい公開セットはありません。');
  for (const r of results) {
    console.log(r.result === 'preview'
      ? `○ ${r.title}\n  プレビュー：${r.articleUrl}${r.pushed ? `\n  レビュー（PR）を作る：${r.prUrl}` : '（--push で送った後に見られます）'}`
      : `× ${r.file}：${r.reason}`);
  }
  console.log('本番にはまだ公開していません。プレビューを確認し、GitHubのレビュー（PR）で承認してから公開します。');
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  autoApproved(process.argv.slice(2)).catch((e) => { console.error(`× ${e.message}`); process.exit(1); });
}

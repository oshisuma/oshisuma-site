// 段階⑤のテスト（本番用モードの動き）：node tools/cases/test-publish.mjs
// リポジトリを一時フォルダに丸ごと写し、その写しの中でだけ「本番用モード」を動かす。
// 元のリポジトリ（作業ブランチ）・本番HPには何も書き込まない。データは架空。

import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ROOT } from './lib.mjs';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ○ ${name}`); } else { fail++; console.log(`  × ${name}${detail ? `\n      ${detail}` : ''}`); }
};
const hash = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

// ---------------------------------------------------------------- 写しを作る
const copy = mkdtempSync(join(tmpdir(), 'oshisuma-publish-'));
cpSync(ROOT, copy, { recursive: true, filter: (src) => !src.split(sep).includes('.git') && !src.split(sep).includes('node_modules') });
const C = (rel) => join(copy, rel);
const { fingerprint } = await import(new URL(`file:///${C('tools/cases/lib.mjs').replace(/\\/g, '/')}`).href);
const protectedFiles = [
  'repair/cases/2026-11-13-mito-iphone13pro-screen-battery/index.html',
  'repair/cases/2026-11-13-hitachinaka-switch-battery/index.html',
  'repair/cases/cases.css', 'index.html',
  ...readdirSync(C('repair/cases/images')).map((f) => `repair/cases/images/${f}`)
];
const before = Object.fromEntries(protectedFiles.map((f) => [f, hash(C(f))]));
const listBefore = readFileSync(C('repair/cases/index.html'), 'utf8').replace(/\r\n/g, '\n');
const sitemapBefore = readFileSync(C('sitemap.xml'), 'utf8').replace(/\r\n/g, '\n');

// 架空の「本番用」報告：段階②のテストデータ（TEST-0003）を元に、テストの印を外したもの（この写しの中だけ）
const base = JSON.parse(readFileSync(C('content/case-reports/test/TEST-0003.json'), 'utf8'));
const prodReport = (id, slug) => {
  const r = structuredClone(base);
  r.reportId = id;
  r.status = 'approved';
  r.source = { type: 'google-form', note: '架空（テスト用の写しの中だけ）' };
  delete r.intake;
  r.drafts.hp.slug = slug;
  // 写真を本番の置き場所（repair/cases/images）へ写したことにする
  for (const m of r.media) {
    for (const ref of [m, m.card, m.gbp].filter(Boolean)) {
      for (const k of ['src', 'webp']) {
        if (!ref[k]) continue;
        const name = ref[k].split('/').pop().replace('mito-iphone12', `mito-iphone12-${id.toLowerCase()}`);
        const to = `/repair/cases/images/${name}`;
        if (!existsSync(C(to.slice(1)))) writeFileSync(C(to.slice(1)), readFileSync(C(ref[k].slice(1))));
        ref[k] = to;
      }
    }
  }
  return r;
};
const candidate = (r, revision = 1, state = 'approved') => ({
  reportId: r.reportId, revision,
  approval: { hp: { state, by: 'oshietesumahoplus@gmail.com', at: '2026-11-14T12:00:00.000Z', fp: fingerprint(r, 'hp') }, gbp: { state: 'approved' } },
  report: r
});
const run = (cands, extra = []) => {
  const f = join(copy, `cands-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(f, JSON.stringify({ exportVersion: 1, exportedAt: new Date().toISOString(), candidates: cands }));
  try { return { code: 0, out: execFileSync('node', ['tools/cases/publish.mjs', '--candidates', f, '--mode', 'production', ...extra], { cwd: copy, encoding: 'utf8' }) }; } catch (e) { return { code: e.status, out: `${e.stdout}${e.stderr}` }; }
};

console.log('\n【1】本番用モード：承認済みの記事を作る（一時フォルダの写しの中だけ）');
const rA = prodReport('R-20261122-aaaa0001', '2026-11-22-mito-iphone12-screen');
let p = run([candidate(rA)]);
check('承認済みの記事を作る', p.code === 0 && /公開用に作成：R-20261122-aaaa0001/.test(p.out), p.out);
const art = readFileSync(C('repair/cases/2026-11-22-mito-iphone12-screen/index.html'), 'utf8');
check('記事は検索対象（index）・正しいURL（canonical）・WebP付き', art.includes('index,follow') && art.includes('https://oshisuma.jp/repair/cases/2026-11-22-mito-iphone12-screen/') && art.includes('type="image/webp"'));
check('ヘッダー・電話/LINEの問い合わせ・店舗情報・フッターは公開済み記事と同じ', ['case-topbar', 'href="tel:09050145311"', 'https://lin.ee/5w0kuAG', 'id="repair-access"', 'home-style-footer'].every((s) => art.includes(s)));
const listAfter = readFileSync(C('repair/cases/index.html'), 'utf8').replace(/\r\n/g, '\n');
const card = listAfter.match(/    <article class="case-list-card"><a href="\/repair\/cases\/2026-11-22-mito-iphone12-screen\/">[\s\S]*?<\/a><\/article>\n/);
check('一覧の先頭（目印の直後）にカードを1枚だけ追加', card && listAfter.indexOf(card[0]) < listAfter.indexOf('2026-11-13-mito-iphone13pro-screen-battery'));
check('一覧ページは、カード1枚の追加以外は1文字も変わらない（公開済み2件のカードもそのまま）', card && listAfter.replace(card[0], '') === listBefore);
const smAfter = readFileSync(C('sitemap.xml'), 'utf8').replace(/\r\n/g, '\n');
const line = '  <url><loc>https://oshisuma.jp/repair/cases/2026-11-22-mito-iphone12-screen/</loc></url>\n';
check('サイトマップに1行だけ追加', smAfter.includes(line) && smAfter.replace(line, '') === sitemapBefore);
check('公開済みの記事2件・CSS・トップページ・既存の画像は1つも変わらない', protectedFiles.every((f) => hash(C(f)) === before[f]), protectedFiles.filter((f) => hash(C(f)) !== before[f]).join(', '));
const recA = JSON.parse(readFileSync(C('content/case-reports/published/R-20261122-aaaa0001.json'), 'utf8'));
check('報告データ（公開記録つき）を保存。Google最新情報は投稿しない', recA.status === 'published' && recA.publishLog.hp.fp && recA.publishLog.gbp === null);

console.log('\n【2】承認状態・二重登録・古い内容');
p = run([candidate(rA)]);
check('同じ内容をもう一度：何もしない', /見送り：R-20261122-aaaa0001（同じ内容で公開済み/.test(p.out) && readFileSync(C('repair/cases/index.html'), 'utf8').replace(/\r\n/g, '\n') === listAfter);
const rA2 = structuredClone(rA);
rA2.drafts.hp.cardSummary = '画面割れと表示のすじに対応し、画面修理を行いました（修正版）。';
p = run([candidate(rA2, 2)]);
const list2 = readFileSync(C('repair/cases/index.html'), 'utf8');
check('修正して再承認された新しい版は、記事とカードを置き換える（カードは1枚のまま）', /更新：/.test(p.out) && list2.includes('（修正版）') && list2.split('/2026-11-22-mito-iphone12-screen/').length - 1 === 1, p.out);
p = run([candidate(rA, 1)]);
check('古い版（第1版）は、新しい版を上書きしない', /見送り：.*古い版/.test(p.out) && readFileSync(C('repair/cases/index.html'), 'utf8').includes('（修正版）'), p.out);
const rB = prodReport('R-20261122-bbbb0002', '2026-11-22-mito-iphone12-screen-b');
for (const st of ['draft', 'returned']) {
  p = run([candidate(rB, 1, st)]);
  check(`HP記事が「${st === 'draft' ? '確認待ち（未承認・承認取り消し）' : '差し戻し'}」のものは公開しない`, /見送り：R-20261122-bbbb0002（HP記事が承認済みではありません/.test(p.out) && !existsSync(C('repair/cases/2026-11-22-mito-iphone12-screen-b')));
}
const tamper = candidate(rB);
tamper.report.drafts.hp.cardSummary = '承認の後で書き換え';
p = run([tamper]);
check('承認後に書き換えられたものはエラーにして公開しない', p.code === 1 && /承認した後に内容が変わっています/.test(p.out) && !existsSync(C('repair/cases/2026-11-22-mito-iphone12-screen-b')));
const clash = prodReport('R-20261122-cccc0003', '2026-11-13-mito-iphone13pro-screen-battery');
p = run([candidate(clash)]);
check('公開済みの手作り記事と同じURLは上書きしない', p.code === 1 && /すでにページがあります/.test(p.out) && hash(C(protectedFiles[0])) === before[protectedFiles[0]]);
const steal = prodReport('R-20261122-dddd0004', '2026-11-22-mito-iphone12-screen');
p = run([candidate(steal)]);
check('別の報告が同じURLを使おうとしたら止める', p.code === 1 && /別の報告/.test(p.out));
const preview = structuredClone(base);
preview.status = 'approved'; preview.source = { type: 'google-form' }; preview.reportId = 'R-20261122-eeee0005'; preview.drafts.hp.slug = '2026-11-22-preview-image-test'; delete preview.intake;
p = run([candidate(preview)]);
check('確認用フォルダ（_preview）の写真を使う記事は、本番用に作らない', p.code === 1 && /写真の置き場所/.test(p.out));
const testData = structuredClone(base); delete testData.intake;
p = run([candidate(testData)]);
check('テストデータ（status: test）は本番用に作らない', p.code === 1 && /テストデータは本番用に作りません/.test(p.out));
const logLines = readFileSync(C('content/case-reports/_logs/publish.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
check('すべての結果（作成・更新・見送り・エラー）が記録ファイルに残る', ['published', 'updated', 'skipped', 'error'].every((k) => logLines.some((l) => l.result === k)));
check('公開済みの記事2件・CSS・トップページ・既存の画像は最後まで変わらない', protectedFiles.every((f) => hash(C(f)) === before[f]));

console.log('\n【3】元のリポジトリには書き込んでいない');
const status = execFileSync('git', ['status', '--porcelain', '--', 'repair/cases/index.html', 'sitemap.xml', 'repair/cases/images', 'content/case-reports/published'], { cwd: ROOT, encoding: 'utf8' }).trim();
check('作業ブランチの一覧・サイトマップ・画像・公開記録は変わっていない', status === '', status);

console.log(`\n結果：成功 ${pass}件／失敗 ${fail}件`);
process.exit(fail ? 1 : 0);

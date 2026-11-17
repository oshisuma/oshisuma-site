// 本番（main）に入れる前の確認：テスト用のデータ・確認用ページが混ざっていないか
//   node tools/cases/check-no-test-data.mjs
// Gitで管理しているファイルを調べ、1つでも見つかれば終了コード1で止める。

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];
const badPath = [
  [/(^|\/)_preview\//, '確認用ページ（_preview）'],
  [/^content\/case-reports\/test\//, 'テストデータ（content/case-reports/test）'],
  [/_published-test\//, 'テストの公開記録（_published-test）'],
  [/publish-test\.jsonl$/, 'テストの記録ファイル（publish-test.jsonl）'],
  [/(^|\/)TEST-\d{4}/, 'テストの報告ID（TEST-xxxx）']
];
for (const f of files) {
  for (const [re, label] of badPath) if (re.test(f)) problems.push(`${label}：${f}`);
}
// 公開記録・記事ページの中身にテストの印がないか
for (const f of files.filter((x) => /^content\/case-reports\/published\/.+\.json$/.test(x))) {
  const r = JSON.parse(readFileSync(join(ROOT, f), 'utf8'));
  if (r.status !== 'published' || (r.source && r.source.type === 'test')) problems.push(`テスト用の状態の公開記録：${f}`);
}
for (const f of files.filter((x) => /^repair\/cases\/[^/]+\/index\.html$/.test(x) || x === 'repair/cases/index.html' || x === 'sitemap.xml')) {
  const t = readFileSync(join(ROOT, f), 'utf8');
  if (/【テスト|架空のテスト|_preview|TEST-\d{4}|noindex,nofollow/.test(t)) problems.push(`テストの印があるページ：${f}`);
}
if (problems.length) {
  console.log('× テスト用のものが混ざっています：');
  problems.forEach((p) => console.log(`   ${p}`));
  process.exit(1);
}
console.log(`○ テスト用のデータ・確認用ページは含まれていません（${files.length}ファイルを確認）`);

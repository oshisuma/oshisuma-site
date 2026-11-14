// 修理報告データから「確認用ページ」を作る（段階①：テスト・下書き用）
//   node tools/cases/build.mjs          … 確認用ページを作る
//   node tools/cases/build.mjs --check  … 作らずに確認だけ行う（問題があれば終了コード1）
//
// 書き込むのは repair/cases/_preview/ の中だけ。公開済みの記事・一覧・画像には書き込まない。
// 確認用ページは検索エンジンに載せない（noindex）。どこからもリンクしない。

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  ROOT, PREVIEW_DIR, loadShell, loadReports, validateAll, renderArticle, renderCard,
  renderGbpPost, hpTitle, esc, GBP_SUMMARY_MAX
} from './lib.mjs';

const checkOnly = process.argv.includes('--check');
const shell = loadShell();
const results = validateAll(loadReports());
let failed = false;

for (const { file, report, errors, warnings } of results) {
  const name = relative(ROOT, file).replace(/\\/g, '/');
  if (errors.length) {
    failed = true;
    console.log(`× ${name}`);
    errors.forEach((e) => console.log(`   エラー：${e}`));
  } else {
    console.log(`○ ${name}`);
  }
  warnings.forEach((w) => console.log(`   注意：${w}`));
}

const ready = results.filter((r) => !r.errors.length && ['test', 'draft', 'review'].includes(r.report.status));

function writeIfChanged(rel, content) {
  const path = join(ROOT, rel);
  if (!path.startsWith(join(ROOT, PREVIEW_DIR))) throw new Error(`確認用フォルダの外には書き込みません：${rel}`);
  const before = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null;
  if (before === content) return false;
  if (checkOnly) { failed = true; console.log(`   作り直しが必要：${rel}`); return false; }
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
  return true;
}

const reviewHead = (title) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="robots" content="noindex,nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/repair/repair.css"><link rel="stylesheet" href="/repair/cases/cases.css?v=20261113m">
<style>
.rv-box{background:#fff;border:1px solid #d6dee8;border-radius:14px;padding:18px 18px 16px;margin:0 0 22px;color:#0f2b46}
.rv-box h2{font-size:18px;margin:0 0 10px;color:#0f2b46}
.rv-label{display:inline-block;font-size:12px;font-weight:700;color:#ff6a00;letter-spacing:.08em;margin-bottom:6px}
.rv-text{white-space:pre-wrap;line-height:1.9;font-size:15px;margin:0}
.rv-meta{font-size:13px;color:#3e5873;margin:10px 0 0;line-height:1.7;word-break:break-all}
.rv-note{background:#fff4ec;border:1px solid #ffd2b0;border-radius:10px;padding:10px 12px;font-size:14px;line-height:1.7;margin:0 0 18px;color:#0f2b46}
.rv-list{margin:0;padding-left:1.2em;font-size:14px;line-height:1.8}
.rv-img{max-width:240px;border-radius:10px;display:block;margin-top:10px}
</style>
</head>
<body class="case-page">
`;

const index = [];
for (const { report, warnings } of ready) {
  const hp = report.drafts.hp;
  const dir = `${PREVIEW_DIR}/${hp.slug}`;
  writeIfChanged(`${dir}/index.html`, renderArticle(report, { shell, preview: true }));

  const post = renderGbpPost(report);
  const gbpPhoto = report.media.find((m) => m.id === report.drafts.gbp.media);
  const review = reviewHead(`確認用：${hpTitle(hp)}`) +
`<main><div class="case-container case-section">
  <p class="case-eyebrow">確認用ページ（公開されていません）</p>
  <h1 style="font-size:clamp(24px,4vw,34px);line-height:1.4;color:#0f2b46;margin:4px 0 18px">${esc(hpTitle(hp))}</h1>
  <p class="rv-note">${report.status === 'test' ? 'これは<strong>架空のテストデータ</strong>です。実在のお客様・修理ではありません。<br>' : ''}報告ID：${esc(report.reportId)} ／ 状態：${esc(report.status)}</p>

  <section class="rv-box"><span class="rv-label">① HP記事</span><h2>記事ページ</h2>
    <p class="rv-text"><a href="./">記事の表示を確認する →</a></p>
    <p class="rv-meta">公開時のURL：https://oshisuma.jp/repair/cases/${esc(hp.slug)}/</p>
  </section>

  <section class="rv-box"><span class="rv-label">② HP一覧</span><h2>一覧ページのカード</h2>
  <div class="case-list" style="margin:0">
${renderCard(report)}  </div>
  </section>

  <section class="rv-box"><span class="rv-label">③ Google最新情報</span><h2>Googleビジネスプロフィールの投稿（下書き）</h2>
    <p class="rv-text">${esc(post.summary)}</p>
    ${gbpPhoto ? `<img class="rv-img" src="${esc(gbpPhoto.src)}" alt="${esc(gbpPhoto.alt)}" width="${gbpPhoto.width}" height="${gbpPhoto.height}" loading="lazy">` : ''}
    <p class="rv-meta">文字数：${post.summary.length}／${GBP_SUMMARY_MAX}<br>ボタン：詳細（LEARN_MORE）→ ${esc(post.callToAction.url)}<br>写真：${esc(post.media.map((m) => m.sourceUrl).join(', ') || 'なし')}<br>※Googleへは送信していません。</p>
  </section>

  <section class="rv-box"><span class="rv-label">④ 確認事項</span><h2>自動チェックの結果</h2>
    ${warnings.length ? `<ul class="rv-list">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="rv-text">問題は見つかりませんでした。</p>'}
  </section>
</div></main>
</body>
</html>
`;
  writeIfChanged(`${dir}/review.html`, review);
  index.push(`  <li><a href="${esc(hp.slug)}/review.html">${esc(hpTitle(hp))}</a>（${esc(report.status)}）</li>`);
}

writeIfChanged(`${PREVIEW_DIR}/index.html`, reviewHead('修理事例 確認用ページ一覧') +
`<main><div class="case-container case-section">
  <p class="case-eyebrow">確認用ページ（公開されていません）</p>
  <h1 style="font-size:clamp(24px,4vw,34px);color:#0f2b46;margin:4px 0 18px">修理事例の下書き一覧</h1>
  <ul class="rv-list">
${index.join('\n')}
  </ul>
</div></main>
</body>
</html>
`);

console.log(checkOnly ? '確認のみ（書き込みなし）' : `確認用ページ：${ready.length}件`);
process.exit(failed ? 1 : 0);

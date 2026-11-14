// 段階⑤：承認済みのHP記事を、HP公開用のデータ・ページにする
//   node tools/cases/publish.mjs --candidates <HP公開候補のJSON> [--mode test|production] [--dry-run]
//
// 入力：承認画面（Apps Script）の exportHpCandidates が書き出した「HP公開候補」
// 公開するのは、HP記事が承認済みで、承認した時点から内容が変わっていない（指紋が一致する）ものだけ。
//
// --mode test（既定）… 架空のテストデータだけを受け付け、確認用フォルダ（repair/cases/_preview/published/）に作る。
//                      本物の一覧・記事・サイトマップには一切書き込まない。
// --mode production … テストデータは受け付けない。記事ページ・一覧のカード・サイトマップ・報告データを作る。
//                      このプログラムはファイルを作るだけで、GitHubへの送信・公開はしない（公開はPRの承認・マージで人が行う）。
//
// どちらのモードでも：
// - 公開済みの手作りの記事（このしくみ以前のもの）と、その一覧カードは変更しない
// - 同じ報告IDは二重に登録しない（同じ内容なら何もしない。新しい版で再承認されたものだけ更新）
// - 結果（公開・更新・見送り・エラー）を記録ファイルに残す
// - Google最新情報は承認状態を記録するだけで、投稿はしない

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  ROOT, SITE, CASES_URL, loadShell, renderArticle, renderCard, validateReport, fingerprint, hpTitle, readText
} from './lib.mjs';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const candidatesFile = opt('--candidates');
const mode = opt('--mode') || 'test';
const dryRun = args.includes('--dry-run');
if (!candidatesFile) { console.error('--candidates <HP公開候補のJSON> を指定してください。'); process.exit(1); }
if (!['test', 'production'].includes(mode)) { console.error('--mode は test か production です。'); process.exit(1); }

const OUT = mode === 'test'
  ? { records: 'content/case-reports/_published-test', articles: 'repair/cases/_preview/published', list: 'repair/cases/_preview/published/index.html', sitemap: null, log: 'content/case-reports/_logs/publish-test.jsonl', imagePrefix: '/repair/cases/_preview/images/' }
  : { records: 'content/case-reports/published', articles: 'repair/cases', list: 'repair/cases/index.html', sitemap: 'sitemap.xml', log: 'content/case-reports/_logs/publish.jsonl', imagePrefix: '/repair/cases/images/' };
const LIST_MARKER = '    <!-- 修理事例カード：新しい事例は先頭に追加する -->\n';

const abs = (rel) => join(ROOT, rel);
const write = (rel, text) => { if (dryRun) return; mkdirSync(dirname(abs(rel)), { recursive: true }); writeFileSync(abs(rel), text); };
const results = [];
const record = (reportId, result, reason) => {
  const line = { at: new Date().toISOString(), mode, reportId, result, reason };
  results.push(line);
  console.log(`${{ published: '○ 公開用に作成', updated: '○ 新しい版に更新', skipped: '- 見送り', error: '× エラー' }[result]}：${reportId}${reason ? `（${reason}）` : ''}`);
};

// ---------------------------------------------------------------- 読み込み
const input = JSON.parse(readFileSync(candidatesFile, 'utf8'));
if (input.exportVersion !== 1 || !Array.isArray(input.candidates)) { console.error('HP公開候補の形式が正しくありません。'); process.exit(1); }

// このしくみで公開した記録（報告ID → 記録）。手作りの記事はここに含まれない
const published = new Map();
if (existsSync(abs(OUT.records))) {
  for (const f of readdirSync(abs(OUT.records)).filter((x) => x.endsWith('.json'))) {
    const r = JSON.parse(readFileSync(join(abs(OUT.records), f), 'utf8'));
    published.set(r.reportId, r);
  }
}
const ownedSlugs = new Map([...published.values()].map((r) => [r.drafts.hp.slug, r.reportId]));

// 同じ報告IDが同じ書き出しに2回あれば、新しい版だけを使う（同じ版で内容が違えば止める）
const byId = new Map();
for (const c of input.candidates) {
  const prev = byId.get(c.reportId);
  if (!prev || c.revision > prev.revision) byId.set(c.reportId, c);
  else if (c.revision === prev.revision && c.approval.hp.fp !== prev.approval.hp.fp) byId.set(c.reportId, { ...c, conflict: true });
}

// ---------------------------------------------------------------- 1件ずつ確認して作る
const shell = loadShell();
let listHtml = mode === 'test' && !existsSync(abs(OUT.list))
  ? readText('repair/cases/index.html').replace('<meta name="robots" content="index,follow,max-image-preview:large">', '<meta name="robots" content="noindex,nofollow">')
  : readText(OUT.list);
let sitemap = OUT.sitemap ? readText(OUT.sitemap) : null;
let changedList = false;

for (const c of byId.values()) {
  const r = c.report;
  const id = c.reportId;
  try {
    if (c.conflict) throw new Error('同じ版で内容の違う公開候補が2つあります。');
    if (!r || r.reportId !== id) throw new Error('公開候補のデータが正しくありません。');
    // テストデータは本番に出さない／本番データはテストに混ぜない
    const isTest = r.status === 'test' || (r.source && r.source.type === 'test');
    if (mode === 'production' && isTest) throw new Error('テストデータは本番用に作りません。');
    if (mode === 'test' && !isTest) throw new Error('テストモードでは、テストデータ以外は扱いません。');
    // 承認の確認：HP記事が承認済みで、承認した時点から内容が変わっていないか
    const hpApproval = c.approval && c.approval.hp;
    if (!hpApproval || hpApproval.state !== 'approved') { record(id, 'skipped', 'HP記事が承認済みではありません'); continue; }
    if (!hpApproval.fp || hpApproval.fp !== fingerprint(r, 'hp')) throw new Error('承認した後に内容が変わっています（承認し直しが必要）。');
    // 二重登録の防止・古い内容で上書きしない
    const before = published.get(id);
    if (before) {
      if (before.publishLog.hp.fp === hpApproval.fp) { record(id, 'skipped', '同じ内容で公開済み'); continue; }
      if (c.revision <= before.publishLog.hp.revision) { record(id, 'skipped', `公開済みの版（${before.publishLog.hp.revision}）より古い版です`); continue; }
      if (before.drafts.hp.slug !== r.drafts.hp.slug) throw new Error('公開済みの記事のURLは変えられません。');
    }
    const slug = r.drafts.hp.slug;
    if (ownedSlugs.has(slug) && ownedSlugs.get(slug) !== id) throw new Error(`記事のURL「${slug}」は別の報告（${ownedSlugs.get(slug)}）が使っています。`);
    if (!before && existsSync(abs(`${OUT.articles}/${slug}`))) throw new Error(`記事のURL「${slug}」には、すでにページがあります（上書きしません）。`);
    // 内容・写真の確認（段階①②の確認を「承認済み」の厳しさで行う）
    // Google投稿だけの問題（写真なし・文字数など）は、HP記事の公開を止めない（Googleは別に承認・投稿する）
    const check = validateReport({ ...r, status: 'approved' });
    const hpErrors = check.errors.filter((e) => !/^Google投稿|drafts\.gbp/.test(e));
    if (hpErrors.length) throw new Error(hpErrors.join(' '));
    const used = [r.drafts.hp.featureMedia, r.drafts.hp.cardMedia].map((m) => r.media.find((x) => x.id === m));
    if (used.some((m) => !m || !m.card || !m.webp)) throw new Error('記事の写真の公開用画像（段階②の処理）がありません。');
    if (used.some((m) => !m.src.startsWith(OUT.imagePrefix))) throw new Error(`写真の置き場所が ${OUT.imagePrefix} ではありません。`);

    // ページ・カード・サイトマップを作る
    const out = JSON.parse(JSON.stringify(r));
    out.status = mode === 'test' ? 'test' : 'published';
    out.approval = c.approval;
    out.publishLog = {
      hp: { at: new Date().toISOString(), revision: c.revision, fp: hpApproval.fp, approvedBy: hpApproval.by, approvedAt: hpApproval.at },
      gbp: null    // Google最新情報は承認状態を記録するだけ（投稿はまだしない）
    };
    const article = renderArticle(out, { shell, preview: mode === 'test' });
    let card = renderCard(out);
    if (mode === 'test') card = card.replace(`href="${CASES_URL}${slug}/"`, `href="/${OUT.articles}/${slug}/"`);
    const cardRe = new RegExp(`    <article class="case-list-card"><a href="[^"]*/${slug}/">[\\s\\S]*?<\\/a><\\/article>\\n`);
    if (!listHtml.includes(LIST_MARKER)) throw new Error('一覧ページにカードを追加する目印が見つかりません。');
    listHtml = cardRe.test(listHtml) ? listHtml.replace(cardRe, card) : listHtml.replace(LIST_MARKER, LIST_MARKER + card);
    changedList = true;
    if (sitemap) {
      const loc = `  <url><loc>${SITE}${CASES_URL}${slug}/</loc></url>\n`;
      if (!sitemap.includes(loc)) {
        const listLoc = `  <url><loc>${SITE}${CASES_URL}</loc></url>\n`;
        if (!sitemap.includes(listLoc)) throw new Error('サイトマップに修理事例一覧の行が見つかりません。');
        sitemap = sitemap.replace(listLoc, listLoc + loc);
      }
    }
    write(`${OUT.articles}/${slug}/index.html`, article);
    write(`${OUT.records}/${id}.json`, `${JSON.stringify(out, null, 2)}\n`);
    published.set(id, out);
    ownedSlugs.set(slug, id);
    record(id, before ? 'updated' : 'published', `${hpTitle(out.drafts.hp)}／版${c.revision}／Google：${c.approval.gbp ? c.approval.gbp.state : '-'}（投稿はしていません）`);
  } catch (e) {
    record(id, 'error', e.message);
  }
}

if (changedList) write(OUT.list, listHtml);
if (sitemap && changedList) write(OUT.sitemap, sitemap);
if (!dryRun) {
  mkdirSync(dirname(abs(OUT.log)), { recursive: true });
  appendFileSync(abs(OUT.log), results.map((x) => JSON.stringify(x)).join('\n') + (results.length ? '\n' : ''));
}
const count = (k) => results.filter((x) => x.result === k).length;
console.log(`結果：公開用に作成 ${count('published')}件／更新 ${count('updated')}件／見送り ${count('skipped')}件／エラー ${count('error')}件${dryRun ? '（確認のみ・書き込みなし）' : ''}`);
process.exit(count('error') ? 1 : 0);

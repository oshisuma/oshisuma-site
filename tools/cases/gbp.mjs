// Googleビジネスプロフィール：「最新情報」の投稿と「写真一覧」への写真追加（別々に管理）
//   node tools/cases/gbp.mjs --candidates <公開用の画像を用意した公開候補JSON> --state <記録フォルダ（リポジトリの外）> [--mode plan|mock|live]
//
//   plan（既定）… 送る内容を表示するだけ。Googleに接続せず、記録も書かない
//   mock        … Googleの代わりの模擬で、投稿・記録・再実行・二重投稿の防止を確かめる（テスト用）
//   live        … まだ使えない（Business Profile API の利用申請が承認され、オーナーが承認するまで止める）
//
// 守ること
// - HP記事が公開済み（このしくみの公開記録があり、承認した内容と同じ）でなければ、Googleには何もしない
// - 最新情報は「Google投稿」の承認、写真一覧は「Google写真一覧」の承認が、それぞれ有効なとき（承認後に内容が変わっていない）だけ
// - 成功したものは二度送らない。失敗したものだけを次の実行で送り直す
// - 送る直前に「送信中」と記録する。前回が送信中のまま止まっていたら、二重投稿を防ぐため自動では送り直さない
// - 投稿ID・写真ID・成功／失敗・日時は --state のフォルダ（リポジトリの外）に記録する。認証情報は扱わない

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, SITE, renderGbpPost, fingerprint, imageSize } from './lib.mjs';
import { gbpPhotoIds, GBP_PHOTO_LIMITS } from './photos.mjs';

export const PHOTO_CATEGORY = 'AT_WORK';   // 写真の分類：仕事風景

// ---------------------------------------------------------------- 模擬のGoogle（テスト用）
export function mockClient({ fail = [], crashOn = null } = {}) {
  let n = 0;
  const posts = new Map();
  const media = new Map();
  const calls = [];
  return {
    calls, posts, media,
    createPost(payload, key) {
      calls.push(['createPost', key]);
      if (crashOn === key) throw Object.assign(new Error('模擬：処理の途中で止まりました'), { crash: true });
      if (fail.includes(key)) throw new Error('模擬：Googleが受け付けませんでした');
      const name = `mock/localPosts/${++n}`;
      posts.set(name, payload);
      return { name, state: 'LIVE', searchUrl: `https://mock.invalid/${name}` };
    },
    getPost(name) { return posts.has(name) ? { state: 'LIVE' } : { state: 'NOT_FOUND' }; },
    uploadPhoto(item, key) {
      calls.push(['uploadPhoto', key]);
      if (crashOn === key) throw Object.assign(new Error('模擬：処理の途中で止まりました'), { crash: true });
      if (fail.includes(key)) throw new Error('模擬：Googleが受け付けませんでした');
      const name = `mock/media/${++n}`;
      media.set(name, item);
      return { name, googleUrl: `https://mock.invalid/${name}` };
    },
    getPhoto(name) { return media.has(name) ? { googleUrl: `https://mock.invalid/${name}` } : null; }
  };
}

// ---------------------------------------------------------------- 送る内容を作る・確かめる
const isTestReport = (r) => r.status === 'test' || (r.source && r.source.type === 'test');

function approvalOk(c, ch) {
  const a = c.approval && c.approval[ch];
  if (!a || a.state !== 'approved') return '承認されていません';
  if (!a.fp || a.fp !== fingerprint(c.report, ch)) return '承認した後に内容が変わっています（承認し直しが必要）';
  return '';
}

// HP記事が公開済みか（このしくみの公開記録があり、承認したHP記事と同じ内容か）
function hpPublished(c) {
  const file = join(ROOT, 'content/case-reports/published', `${c.reportId}.json`);
  if (!existsSync(file)) return 'HP記事がまだ公開されていません（公開記録がありません）';
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  if (!rec.publishLog || !rec.publishLog.hp || rec.publishLog.hp.fp !== (c.approval.hp && c.approval.hp.fp)) return 'HPに公開した記事と、承認したHP記事の内容が違います';
  return '';
}

export function buildPlan(c) {
  const r = c.report;
  const plan = { reportId: c.reportId, post: null, photos: [], blocked: [] };
  const hpProblem = hpPublished(c);
  if (hpProblem) plan.blocked.push(hpProblem);
  // 最新情報
  const postProblem = approvalOk(c, 'gbp');
  if (postProblem) plan.blocked.push(`最新情報：${postProblem}`);
  else {
    const payload = renderGbpPost(r);
    const errs = [];
    if (!payload.summary || payload.summary.length > 1500) errs.push('本文は1〜1500文字');
    if (!payload.callToAction.url.startsWith(`${SITE}/repair/cases/`)) errs.push('「詳細」ボタンのリンク先がHPの修理事例ではありません');
    if (!payload.media.length || !payload.media[0].sourceUrl.startsWith(`${SITE}/repair/cases/images/`)) errs.push('代表写真がHPに公開された画像ではありません');
    if (errs.length) plan.blocked.push(`最新情報：${errs.join('／')}`);
    else plan.post = { key: 'post', fp: c.approval.gbp.fp, payload };
  }
  // 写真一覧（最新情報とは別）
  const photoProblem = approvalOk(c, 'gbpPhotos');
  if (photoProblem) plan.blocked.push(`写真一覧：${photoProblem}`);
  else {
    for (const id of gbpPhotoIds(r)) {
      const m = r.media.find((x) => x.id === id);
      const f = m.gbpPhoto && m.gbpPhoto.file;
      let err = '';
      if (!f || !existsSync(f)) err = '写真一覧用の画像がありません（prepare-approved.mjs の --gbp-out で作ってください）';
      else {
        const bytes = statSync(f).size;
        const size = imageSize(f);
        if (bytes < GBP_PHOTO_LIMITS.minBytes || bytes > GBP_PHOTO_LIMITS.maxBytes) err = `画像の大きさが${bytes}バイトです（10KB以上5MB以下）`;
        else if (!size || Math.min(size.width, size.height) < GBP_PHOTO_LIMITS.minShortEdge) err = '画像が小さすぎます（短い辺250px以上）';
      }
      if (err) plan.blocked.push(`写真一覧 ${id}：${err}`);
      else plan.photos.push({ key: `photo:${id}`, mediaId: id, fp: c.approval.gbpPhotos.fp, item: { mediaFormat: 'PHOTO', locationAssociation: { category: PHOTO_CATEGORY }, description: m.alt, file: f, fileName: m.gbpPhoto.name } });
    }
  }
  return plan;
}

// ---------------------------------------------------------------- 実行（記録・二重投稿の防止・失敗分だけ再実行）
export function runGbp({ candidates, stateDir, mode = 'plan', client = null, now = () => new Date().toISOString(), log = console.log }) {
  if (!['plan', 'mock', 'live'].includes(mode)) throw new Error('--mode は plan・mock・live のどれかです。');
  if (mode === 'live') throw new Error('Googleへの本番投稿は、まだ使えません（API利用申請の承認と、オーナーの承認が必要です）。');
  if (mode === 'mock' && !client) throw new Error('模擬実行には模擬のGoogleが必要です。');
  if (mode !== 'plan') {
    if (!stateDir) throw new Error('--state（記録フォルダ）を指定してください。');
    const rel = relative(ROOT, resolve(stateDir));
    if (!rel.startsWith('..') && !isAbsolute(rel)) throw new Error('--state はリポジトリの外のフォルダにしてください（投稿IDなどの記録はHPに置きません）。');
    mkdirSync(stateDir, { recursive: true });
  }
  const results = [];
  const history = (e) => { results.push(e); if (mode !== 'plan') appendFileSync(join(stateDir, 'history.jsonl'), JSON.stringify(e) + '\n'); };
  for (const c of candidates) {
    const id = c.reportId;
    const plan = buildPlan(c);
    if (mode === 'live' && isTestReport(c.report)) plan.blocked.push('テストデータはGoogleに投稿しません');
    const statePath = mode === 'plan' ? null : join(stateDir, `${id}.json`);
    const state = statePath && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { reportId: id, mode, post: null, photos: {} };
    if (state.mode !== mode) throw new Error(`${id}：記録は「${state.mode}」のものです。別のモードの記録は使えません。`);
    const save = () => { if (statePath) writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n'); };
    if (plan.blocked.length && (plan.blocked.some((b) => b.startsWith('HP記事') || b.startsWith('テスト')))) {
      plan.blocked.forEach((b) => history({ at: now(), mode, reportId: id, target: '-', result: 'blocked', reason: b }));
      log(`× ${id}：${plan.blocked.join('／')}`);
      continue;
    }
    plan.blocked.forEach((b) => history({ at: now(), mode, reportId: id, target: b.startsWith('最新情報') ? 'post' : 'photos', result: 'blocked', reason: b }));
    // 1件ずつ：成功済みは送らない／送信中のまま止まったものは自動で送り直さない／失敗は送り直す
    const tasks = [];
    if (plan.post) tasks.push({ ...plan.post, kind: 'post', get: () => state.post, set: (v) => { state.post = v; } });
    for (const p of plan.photos) tasks.push({ ...p, kind: 'photo', get: () => state.photos[p.mediaId], set: (v) => { state.photos[p.mediaId] = v; } });
    for (const t of tasks) {
      const label = t.kind === 'post' ? '最新情報' : `写真一覧 ${t.mediaId}`;
      const prev = t.get();
      if (prev && prev.status === 'success') {
        const same = prev.fp === t.fp;
        history({ at: now(), mode, reportId: id, target: t.key, result: same ? 'skipped' : 'blocked', id: prev.name, reason: same ? '送信済み（二重に送らない）' : '送信済みの内容と、今の承認内容が違います（Google上で直接確認・修正が必要）' });
        log(`${same ? '-' : '×'} ${id} ${label}：${same ? `送信済み（${prev.name}）` : '送信済みの内容と違います。自動では送り直しません'}`);
        continue;
      }
      if (prev && prev.status === 'sending') {
        history({ at: now(), mode, reportId: id, target: t.key, result: 'blocked', reason: '前回は送信中のまま止まりました。Google上で掲載の有無を確認してから記録を直してください（二重投稿を防ぐため自動では送り直しません）' });
        log(`× ${id} ${label}：前回の送信が途中で止まっています。Googleで確認が必要です`);
        continue;
      }
      if (mode === 'plan') {
        log(`○ ${id} ${label}：送る予定` + (t.kind === 'post' ? `\n${JSON.stringify(t.payload, null, 2)}` : `（${t.item.fileName}・分類 ${t.item.locationAssociation.category}・説明「${t.item.description}」）`));
        history({ at: now(), mode, reportId: id, target: t.key, result: 'planned' });
        continue;
      }
      t.set({ status: 'sending', fp: t.fp, at: now(), attempts: ((prev && prev.attempts) || 0) + 1 });
      save();
      try {
        const res = t.kind === 'post' ? client.createPost(t.payload, t.key) : client.uploadPhoto(t.item, t.key);
        // 掲載されたかを読み直して確かめる
        const check = t.kind === 'post' ? client.getPost(res.name) : client.getPhoto(res.name);
        const verified = t.kind === 'post' ? check.state : (check && check.googleUrl ? 'FOUND' : 'NOT_FOUND');
        t.set({ status: 'success', fp: t.fp, name: res.name, url: res.searchUrl || res.googleUrl || '', verified, at: now(), attempts: t.get().attempts, ...(t.kind === 'photo' ? { fileName: t.item.fileName } : {}) });
        save();
        history({ at: now(), mode, reportId: id, target: t.key, result: 'success', id: res.name, verified });
        log(`○ ${id} ${label}：成功（${res.name}・確認：${verified}）`);
      } catch (e) {
        if (e.crash) throw e;              // 模擬：記録が「送信中」のまま止まった状態を再現する
        t.set({ status: 'failed', fp: t.fp, error: e.message, at: now(), attempts: t.get().attempts });
        save();
        history({ at: now(), mode, reportId: id, target: t.key, result: 'failed', reason: e.message });
        log(`× ${id} ${label}：失敗（${e.message}）。次の実行で、この分だけ送り直します`);
      }
    }
    save();
  }
  return results;
}

// ---------------------------------------------------------------- コマンドとして実行したとき
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const file = opt('--candidates');
  if (!file) { console.error('--candidates を指定してください。'); process.exit(1); }
  const mode = opt('--mode') || 'plan';
  try {
    const input = JSON.parse(readFileSync(file, 'utf8'));
    const results = runGbp({ candidates: input.candidates, stateDir: opt('--state'), mode, client: mode === 'mock' ? mockClient({ fail: (opt('--mock-fail') || '').split(',').filter(Boolean) }) : null });
    const n = (k) => results.filter((x) => x.result === k).length;
    console.log(`結果（${mode}）：成功 ${n('success')}／送信済みのため見送り ${n('skipped')}／失敗 ${n('failed')}／止めたもの ${n('blocked')}${mode === 'plan' ? `／送る予定 ${n('planned')}（Googleには接続していません）` : ''}`);
    process.exit(n('failed') || n('blocked') ? 1 : 0);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

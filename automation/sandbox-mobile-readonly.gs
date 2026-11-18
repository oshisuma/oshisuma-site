/**
 * 合成テスト専用：スマホ向け・本人限定・読取専用プレビュー。
 * 既存「sandbox-review-actions.gs」と同じテスト用GAS内にだけ追加できる。
 * Apps Script web appへのデプロイは未実施、既定ではアクセス拒否。
 * 必須: Script Propertiesに OSH_SANDBOX_OWNER_EMAIL を本人自身が設定。
 * デプロイを行う場合、アクセス権は必ず「自分のみ」。
 * 既存の管理用Apps Script本番へ追加してはいけない。
 */
function oshSandboxMobileRequireOwner_() {
  const allowed=String(
    PropertiesService.getScriptProperties().getProperty('OSH_SANDBOX_OWNER_EMAIL')||''
  ).trim().toLowerCase();
  const actor=String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();
  if (!allowed || !actor || actor!==allowed)
    throw new Error('閲覧できません（本人のログインを確認してください）');
  if (typeof oshSandboxReviewReadContext_!=='function')
    throw new Error('合成テストの記事読み取り機能がありません');
  // 記事ID・公開状態・シート名・ID・内容を共通ガードで再確認。
  return oshSandboxReviewReadContext_();
}
function oshSandboxMobileRead(){
  oshSandboxMobileRequireOwner_();
  return oshSandboxReviewRead();
}
function doGet(e){
  try{
    oshSandboxMobileRequireOwner_();
  }catch(_){
    return HtmlService.createHtmlOutput(
      '<!doctype html><html lang="ja"><meta charset="utf-8">'+
      '<title>閲覧できません</title>'+
      '<p>このページにはアクセスできません。</p></html>'
    ).setTitle('オシスマ｜アクセスできません');
  }
  const markup=String.raw`<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<title>オシスマ｜架空の記事確認</title>
<style>
:root{font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;color:#292929;background:#fffaf5}
*{box-sizing:border-box}body{margin:0}header{background:#eb741b;color:white;font-weight:800;padding:16px}
main{max-width:640px;margin:auto;padding:16px}.notice{padding:14px;border-radius:12px;background:#fff0dd;color:#793600}
article{background:white;border:1px solid #ecdccd;border-radius:14px;padding:18px;margin:14px 0}
h1{font-size:1.4rem;line-height:1.5;margin:14px 0;color:#a94e06}h2{font-size:1.1rem;padding-top:16px;border-top:1px solid #eee}
p{line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.meta{color:#666;font-size:.92rem}
</style></head><body>
<header>オシスマ｜修理記事の確認テスト</header><main>
<p class="notice">【架空データ専用】本人限定の表示テストです。ここから承認・公開・差戻しはできません。</p>
<p id="message" role="status">記事を読み込んでいます...</p>
<article id="article" hidden><h1 id="title"></h1>
<p id="description"></p><div id="sections"></div>
<p class="meta">写真：なし（写真の動作テストは別工程）</p>
<p id="review"></p><p class="meta">本番HP・Googleへの投稿は行われません。</p>
</article></main>
<script>(function(){
'use strict';
const get=id=>document.getElementById(id);
function add(parent,tag,value){
  const node=document.createElement(tag);
  node.textContent=String(value==null?'':value);
  parent.appendChild(node);
}
function draw(data){
  get('message').textContent='';
  get('title').textContent=data.title;
  get('description').textContent=data.description;
  const host=get('sections');host.replaceChildren();
  for(const sec of data.sections){
    add(host,'h2',sec.heading);
    for(const p of sec.paragraphs)add(host,'p',p);
  }
  const states={unreviewed:'未確認',confirmed:'確認済み（合成テストのみ）',returned:'差戻し（合成テストのみ）'};
  get('review').textContent='確認状態：'+(states[data.review.state]||'不明');
  get('article').hidden=false;
}
if(typeof google!=='undefined'&&google.script&&google.script.run){
  google.script.run.withSuccessHandler(draw).withFailureHandler(function(){
    get('message').textContent='記事を読み込めません。ログイン状態をご確認ください。';
  }).oshSandboxMobileRead();
}else get('message').textContent='Apps Scriptのテスト画面から開いてください。';
})();</script>
</body></html>`;
  return HtmlService.createHtmlOutput(markup).setTitle('オシスマ｜架空の記事確認');
}
/**
 * 合成テスト専用：スマホ閲覧テスト（現行版）
 *
 * Googleスプレッドシート全体の閲覧権限を要求しない方式。
 * ① バインドされたテスト用GASのエディタで、架空記事を安全確認して
 *    oshSandboxMobileCaptureSnapshot() を手動実行
 * ② Script Properties に個人情報を含まない確認用プレビューだけを保存
 * ③ Webアプリは本人限定のスナップショットを表示する
 * ④ 任意の「確認済み」「差し戻し」は Script Properties に合成テスト結果だけ記録
 *
 * 必要スコープ：spreadsheets.currentonly / script.container.ui / userinfo.email
 * スコープ拡張は不要。「すべてのスプレッドシート」権限も不要。
 * 本番GASには追加しない。Webアプリのデプロイは別途承認・実機確認後。
 */
const OSH_SANDBOX_SNAPSHOT_KEY_='OSH_SANDBOX_MOBILE_PREVIEW_V1';

function oshSandboxMobileOwner_(){
  const p=PropertiesService.getScriptProperties();
  const allowed=String(p.getProperty('OSH_SANDBOX_OWNER_EMAIL')||'')
    .trim().toLowerCase();
  const actor=String(Session.getActiveUser().getEmail()||'')
    .trim().toLowerCase();
  if(!allowed || !actor || actor!==allowed)
    throw new Error('本人のログインを確認できません');
  return p;
}

/**
 * エディタでのみ実行するスナップショット更新。
 * 既に実機検証済みのテスト用下書き読み取りを使い、
 * 氏名、報告原文、写真、別のスプレッドシートには触れない。
 */
function oshSandboxMobileCaptureSnapshot(){
  const p=oshSandboxMobileOwner_();
  const ctx=oshSandboxReviewReadContext_(); // ID、名前、行数、架空データのみ検証
  if(ctx.report.reportId!=='R-20261118-demo0001' ||
     ctx.report.source?.mode!=='sandbox' ||
     ctx.report.source?.type!=='synthetic-test' ||
     ctx.report.sandboxReview?.testOnly!==true ||
     ctx.report.sandboxReview?.state!=='confirmed' ||
     ctx.revision!==2 ||
     ctx.report.media?.length!==0 ||
     ctx.report.publishLog?.hp!=null ||
     ctx.report.publishLog?.gbp!=null)
    throw new Error('確認済みの合成テスト記事ではありません');
  const m=oshSandboxReviewRead(); // 表示用に削減されたデータだけ取得
  if(m.reportId!=='R-20261118-demo0001' || m.canPublish!==false ||
     m.photoCount!==0 || m.review?.state!=='confirmed')
    throw new Error('表示用データが不正です');
  const snapshot={
    type:'osh-sandbox-mobile-v1',
    reportId:m.reportId,revision:m.revision,
    title:m.title,description:m.description,sections:m.sections,
    review:{state:'confirmed'},photoCount:0,canPublish:false,
    createdAt:new Date().toISOString()
  };
  const body=JSON.stringify(snapshot);
  if(body.length>12000)throw new Error('テスト用データの容量が大きすぎます');
  p.setProperty(OSH_SANDBOX_SNAPSHOT_KEY_,body);
  Logger.log('成功：合成記事だけのスマホ用プレビューを保存しました（HP公開なし）');
  return {saved:true,reportId:m.reportId,canPublish:false};
}

/** スマホWebアプリから呼ばれる、本人限定・読取専用のAPI。 */
function oshSandboxMobileRead(){
  const p=oshSandboxMobileOwner_();
  const raw=p.getProperty(OSH_SANDBOX_SNAPSHOT_KEY_);
  if(!raw || raw.length>12000)throw new Error('合成テスト記事が準備されていません');
  let m;
  try{m=JSON.parse(raw);}catch(_){throw new Error('表示用データが不正です');}
  if(!m || m.type!=='osh-sandbox-mobile-v1' ||
     m.reportId!=='R-20261118-demo0001' || m.revision!==2 ||
     m.review?.state!=='confirmed' || m.canPublish!==false ||
     m.photoCount!==0 || !Array.isArray(m.sections) ||
     typeof m.title!=='string' || typeof m.description!=='string' ||
     !Number.isFinite(Date.parse(m.createdAt)) ||
     Date.now()-Date.parse(m.createdAt)>7*24*60*60*1000 ||
     Date.parse(m.createdAt)>Date.now()+60000)
    throw new Error('合成テスト用プレビューを確認できません');
  // 意図せぬ構造や過剰な文字列は返さない
  return {
    reportId:m.reportId,revision:m.revision,
    title:m.title.slice(0,350),
    description:m.description.slice(0,1000),
    sections:m.sections.slice(0,12).map(s=>({
      heading:String(s.heading||'').slice(0,100),
      paragraphs:(Array.isArray(s.paragraphs)?s.paragraphs:[])
        .slice(0,15).map(v=>String(v).slice(0,1500))
    })),
    review:{state:'confirmed'},photoCount:0,canPublish:false
  };
}

function doGet(e){
  // 別の架空記事だけを表示する差し戻し専用テスト画面。
  // 通常の記事や前回の確認記録には触れない。
  if(e && e.parameter && e.parameter.mode==='return'){
    try{return oshSandboxReturnPage();}
    catch(_){return HtmlService.createHtmlOutput(
      '<!doctype html><html lang="ja"><meta charset="utf-8">'+
      '<title>閲覧できません</title><p>このページにはアクセスできません。</p></html>'
    ).setTitle('オシスマ｜アクセスできません');}
  }
  try{oshSandboxMobileRead();}
  catch(_){
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
#controls{padding:18px;background:#fff;border:1px solid #e8cdb6;border-radius:14px;margin:14px 0}button{font:inherit;font-weight:750;min-height:48px;padding:12px;border-radius:10px;border:0;width:100%;margin-top:10px}#confirm{background:#eb741b;color:#fff}#return{background:#ffead7;color:#703600}button:disabled{opacity:.55}textarea{width:100%;min-height:90px;font:inherit;border:1px solid #bbb;border-radius:8px;padding:10px;box-sizing:border-box}label{display:block;font-weight:650;margin-top:14px}#actionStatus{font-weight:700;white-space:pre-wrap}
p{line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.meta{color:#666;font-size:.92rem}
</style></head><body>
<header>オシスマ｜修理記事の確認テスト</header><main>
<p class="notice">【架空データ専用】本人限定の操作テストです。この画面での記録は本番記事の承認・公開には一切反映されません。</p>
<p id="message" role="status">記事を読み込んでいます...</p>
<article id="article" hidden><h1 id="title"></h1>
<p id="description"></p><div id="sections"></div>
<p class="meta">写真：なし（写真の動作テストは別工程）</p>
<p id="review"></p><p class="meta">本番HP・Googleへの投稿は行われません。</p>
</article>
<section id="controls" hidden aria-label="架空の記事の操作テスト">
<p><strong>スマホ操作テスト</strong>：結果はテスト用の記録だけに保存します。正式な承認ではありません。</p>
<button type="button" id="confirm">内容を確認済みにする（テスト）</button>
<label for="reason">差し戻す理由（4〜300文字）</label>
<textarea id="reason" maxlength="300" placeholder="例：修理内容の説明を見直してください"></textarea>
<button type="button" id="return">差し戻す（テスト）</button>
<p id="actionStatus" role="status" aria-live="polite"></p>
</section></main>
<script>(function(){
'use strict';
const get=id=>document.getElementById(id);
let current=null;let busy=false;
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
  google.script.run.withSuccessHandler(function(state){
    if(state.reportId!==data.reportId||state.sourceRevision!==data.revision||!state.testOnly||state.canPublish!==false){
      get('actionStatus').textContent='記事とテスト結果が一致しません';return;
    }
    current=state;
    get('controls').hidden=false;
    updateControls();
  }).withFailureHandler(function(){get('actionStatus').textContent='テスト操作の状態を取得できません。閲覧だけ利用できます。';get('controls').hidden=false;get('confirm').disabled=true;get('return').disabled=true;}).oshSandboxMobileReviewState();
}
function updateControls(){
  const done=current&&current.state!=='pending';
  get('confirm').disabled=busy||done;
  get('return').disabled=busy||done;
  get('reason').disabled=busy||done;
  get('actionStatus').textContent=done?(current.state==='confirmed'?'確認済みをテスト記録に保存しました':'差し戻しをテスト記録に保存しました'):(busy?'テスト結果を保存中...':'内容を確認し、どちらか一つを選んでください。');
}
function saveAction(action){
  if(!current||busy||current.state!=='pending')return;
  const reason=action==='return'?get('reason').value.trim():'';
  if(action==='return'&&reason.length<4){get('actionStatus').textContent='差し戻し理由は4文字以上入力してください。';return;}
  if(!window.confirm(action==='confirm'?'架空の記事を「確認済み」と記録しますか？（本番承認ではありません）':'架空の記事を差し戻しますか？（本番には影響しません）'))return;
  busy=true;updateControls();
  google.script.run.withSuccessHandler(function(next){
    busy=false;
    if(next.reportId!==current.reportId||next.sourceRevision!==current.sourceRevision||next.testOnly!==true||next.canPublish!==false){get('controls').hidden=true;return;}
    current=next;updateControls();
  }).withFailureHandler(function(){
    busy=false;get('confirm').disabled=true;get('return').disabled=true;get('reason').disabled=true;
    get('actionStatus').textContent='保存結果を確認できません。画面を更新して状態をご確認ください。';
  }).oshSandboxMobileReviewSave(action,current.sourceTag,reason);
}
get('confirm').addEventListener('click',function(){saveAction('confirm')});
get('return').addEventListener('click',function(){saveAction('return')});
if(typeof google!=='undefined'&&google.script&&google.script.run){
  google.script.run.withSuccessHandler(draw).withFailureHandler(function(){
    get('message').textContent='記事を読み込めません。ログイン状態をご確認ください。';
  }).oshSandboxMobileRead();
}else get('message').textContent='Apps Scriptのテスト画面から開いてください。';
})();</script>
</body></html>`;
  return HtmlService.createHtmlOutput(markup).setTitle('オシスマ｜架空の記事確認');
}
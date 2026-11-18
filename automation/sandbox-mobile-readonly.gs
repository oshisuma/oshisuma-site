/**
 * 合成テスト専用：スマホ向け・本人限定・読取専用プレビュー。
 * 【重要】コンテナバインドGASのgetActiveSpreadsheet()はWebアプリでは使用不可。
 * そのためGoogle Sheets Advanced Service (v4) の Values.get を利用する。
 * 本番未導入・Webアプリ未デプロイ。アクセス対象は固定の合成テストファイルだけ。
 * Script Properties: OSH_SANDBOX_OWNER_EMAIL（本人が設定。未設定なら拒否）
 * appsscript.jsonに spreadsheets.readonly OAuthスコープとSheets v4が必要。
 * 公開時は「自分のみ」でアクセスを制限する。※テスト導入にも事前確認が必要。
 */
function oshSandboxMobileRequireOwner_(){
  const allowed=String(
    PropertiesService.getScriptProperties().getProperty('OSH_SANDBOX_OWNER_EMAIL')||''
  ).trim().toLowerCase();
  const actor=String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();
  if(!allowed || !actor || actor!==allowed)
    throw new Error('閲覧できません（本人のログインを確認してください）');
}
function oshSandboxMobileRead(){
  // 本人以外には記事タイトルさえ返さない。
  oshSandboxMobileRequireOwner_();
  const id='1JB-duIYGsyzSzJXEdHB5SAqRJkQFtxeYmWmXBWm5P-I';
  const name='オシスマ_修理事例自動化_合成テスト専用_20261118';
  const expectedHeaders=['報告ID','版','HP','Google','報告データ（JSON）','更新日時'];
  if(typeof Sheets==='undefined' || !Sheets.Spreadsheets?.get ||
      !Sheets.Spreadsheets.Values?.get)
    throw new Error('読み取り専用Sheetsサービスを設定してください');
  // API参照は対象IDと本文の名前両方で防御し、別ファイルへ切替できないようにする。
  const meta=Sheets.Spreadsheets.get(id,{fields:'spreadsheetId,properties(title)'});
  if(meta?.spreadsheetId!==id || meta?.properties?.title!==name)
    throw new Error('合成テスト専用のシートではありません');
  // 最大100行だけ確認。下書きが複数なら安全停止。
  const values=Sheets.Spreadsheets.Values.get(id,"'下書き'!A1:F100",{
    valueRenderOption:'FORMATTED_VALUE'
  });
  const rows=values?.values||[];
  if(rows.length!==2 || !Array.isArray(rows[0]) || !Array.isArray(rows[1]) ||
     expectedHeaders.some((x,i)=>rows[0][i]!==x))
    throw new Error('架空の下書き1件だけを扱います');
  const row=rows[1],revision=Number(row[1]);
  if(row[0]!=='R-20261118-demo0001' ||
     row[2]!=='draft' || row[3]!=='draft' ||
     !Number.isInteger(revision) || revision<1)
    throw new Error('本番・承認済みの修理報告は表示できません');
  let r;
  try{r=JSON.parse(String(row[4]||''));}
  catch(_){throw new Error('記事のデータを読み取れません');}
  if(!r || r.reportId!==row[0] || r.status!=='draft' ||
     r.source?.type!=='synthetic-test' || r.source?.mode!=='sandbox' ||
     r.approval?.hp?.state!=='draft' || r.approval?.gbp?.state!=='draft' ||
     r.publishLog?.hp!=null || r.publishLog?.gbp!=null ||
     !Array.isArray(r.media) || r.media.length!==0 ||
     !Array.isArray(r.drafts?.hp?.sections) ||
     !Array.isArray(r.drafts.hp.titleServices))
    throw new Error('確認できる架空の記事ではありません');
  const review=r.sandboxReview;
  if(review && (
      !['confirmed','returned'].includes(review.state) ||
      review.testOnly!==true
    ))throw new Error('不正な確認状態です');
  const hp=r.drafts.hp;
  return {
    reportId:r.reportId,revision,
    title:String(hp.titleArea||'')+'の'+String(hp.titleDevice||'')+
      ' '+hp.titleServices.map(x=>String(x).slice(0,100)).join('・')+'修理事例',
    description:String(hp.description||'').slice(0,1000),
    sections:hp.sections.slice(0,12).map(s=>({
      heading:String(s.heading||'').slice(0,100),
      paragraphs:(Array.isArray(s.paragraphs)?s.paragraphs:[])
        .slice(0,15).map(v=>String(v).slice(0,1500))
    })),
    review:{state:review?.state||'unreviewed'},
    canPublish:false,photoCount:0
  };
}
function doGet(e){
  try{oshSandboxMobileRead();}
  catch(_){
    // 403相当の汎用メッセージ。外部にIDや理由を出さない。
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
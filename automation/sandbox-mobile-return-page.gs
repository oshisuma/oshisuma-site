/**
 * 合成差し戻し実機テストの単独ページ。
 * URL: 既存の本人限定Webアプリ/exec?mode=return
 * Google/HPへの投稿機能や、本番承認ボタンは持たない。
 */
function oshSandboxReturnPage(){
  // ページHTMLを返す前に必ず本人確認を行う。
  oshSandboxReturnRead();
  return HtmlService.createHtmlOutput(String.raw`<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<title>オシスマ｜架空の差し戻し確認</title>
<style>
:root{font-family:system-ui,-apple-system,"Noto Sans JP",sans-serif;color:#292929;background:#fffaf5}
*{box-sizing:border-box}body{margin:0}header{padding:16px;background:#eb741b;color:#fff;font-weight:800}
main{max-width:640px;margin:auto;padding:16px}
.notice{padding:14px;border-radius:12px;background:#fff0dd;color:#793600}
article,section{background:#fff;border:1px solid #ecdccd;border-radius:14px;padding:18px;margin:14px 0}
h1{font-size:1.35rem;color:#a94e06;line-height:1.5}h2{font-size:1.1rem;border-top:1px solid #eee;padding-top:14px}
p{line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}.meta{font-size:.9rem;color:#666}
label{display:block;font-weight:700;margin:14px 0 6px}
textarea{width:100%;min-height:100px;padding:10px;border:1px solid #bbb;border-radius:8px;font:inherit}
button{width:100%;min-height:48px;font:inherit;font-weight:750;border:0;border-radius:10px;background:#eb741b;color:white;margin-top:12px}
button:disabled,textarea:disabled{opacity:.55}#actionStatus{font-weight:750}
</style></head><body>
<header>オシスマ｜架空の記事・差し戻しテスト</header>
<main>
<p class="notice">【架空データ専用】前回のiPhone記事とは別のiPadテストです。差し戻し記録はテスト専用で、本番HPの承認・公開には一切反映されません。</p>
<p id="message" role="status">読み込んでいます...</p>
<article id="article" hidden>
<h1 id="title"></h1><p id="description"></p><div id="sections"></div>
<p class="meta">写真：なし（架空テストのみ）</p>
</article>
<section id="controls" hidden>
<strong>差し戻しテスト</strong>
<label for="reason">差し戻し理由（4〜300文字）</label>
<textarea id="reason" maxlength="300" placeholder="例：修理内容をもう少し具体的に説明してください"></textarea>
<button type="button" id="return" disabled>差し戻しを記録する（テスト）</button>
<p id="actionStatus" role="status" aria-live="polite"></p>
</section>
</main><script>(function(){
'use strict';
const el=id=>document.getElementById(id);
let current=null,busy=false;
function add(host,tag,value){const node=document.createElement(tag);node.textContent=String(value==null?'':value);host.appendChild(node);}
function refresh(){
  const done=current&&current.state==='returned';
  el('return').disabled=busy||done||!current;
  el('reason').disabled=busy||done||!current;
  el('actionStatus').textContent=done?'差し戻しをテスト記録に保存しました。理由：'+current.reason:(busy?'保存中...':'差し戻し理由を入力してください。');
}
function draw(data){
  if(!data||data.testOnly!==true||data.canPublish!==false||data.photoCount!==0||data.reportId!=='R-20261119-demo-return0001'){
    el('message').textContent='安全な架空テスト記事ではありません';return;
  }
  current=data;el('message').textContent='';
  el('title').textContent=data.title;el('description').textContent=data.description;
  const host=el('sections');host.replaceChildren();
  for(const sec of data.sections){add(host,'h2',sec.heading);for(const p of sec.paragraphs)add(host,'p',p);}
  el('article').hidden=false;el('controls').hidden=false;refresh();
}
el('return').addEventListener('click',function(){
  if(!current||current.state!=='pending'||busy)return;
  const comment=el('reason').value.trim();
  if(comment.length<4){el('actionStatus').textContent='理由は4文字以上入力してください。';return;}
  if(!window.confirm('架空のiPad記事を差し戻しますか？ 本番の承認・公開には影響しません。'))return;
  busy=true;refresh();
  google.script.run.withSuccessHandler(function(data){
    busy=false;
    if(!data||data.testOnly!==true||data.canPublish!==false||data.reportId!=='R-20261119-demo-return0001'){
      el('controls').hidden=true;return;
    }
    current=data;refresh();
  }).withFailureHandler(function(){
    busy=false;el('return').disabled=true;el('reason').disabled=true;
    el('actionStatus').textContent='保存結果を確認できません。ページを更新して状態をご確認ください。';
  }).oshSandboxReturnSave(current.sourceTag,comment);
});
if(typeof google!=='undefined'&&google.script&&google.script.run){
 google.script.run.withSuccessHandler(draw).withFailureHandler(function(){el('message').textContent='読み込めません。オシスマのGoogleアカウントをご確認ください。';}).oshSandboxReturnRead();
}else el('message').textContent='Apps Scriptのウェブアプリから開いてください。';
})();</script></body></html>`).setTitle('オシスマ｜差し戻しテスト（架空）');
}

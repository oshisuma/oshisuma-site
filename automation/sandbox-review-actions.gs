/**
 * オシスマ／合成データ専用：修理記事の確認・差戻し記録。
 * Apps Scriptコンテナバインド用。本番未導入、Web公開・HP公開なし。
 * 追加スコープは不要（spreadsheets.currentonly と script.container.ui）。
 */
const OSH_REVIEW_SANDBOX = Object.freeze({
  id:'1JB-duIYGsyzSzJXEdHB5SAqRJkQFtxeYmWmXBWm5P-I',
  name:'オシスマ_修理事例自動化_合成テスト専用_20261118',
  reportId:'R-20261118-demo0001',
  headers:['報告ID','版','HP','Google','報告データ（JSON）','更新日時']
});
function oshSandboxReviewReadContext_(){
  const cfg=OSH_REVIEW_SANDBOX;
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss || ss.getId()!==cfg.id || ss.getName()!==cfg.name)
    throw new Error('合成テスト用のシート以外では使えません');
  const sh=ss.getSheetByName('下書き');
  if(!sh || sh.getLastRow()!==2)throw new Error('架空の下書き1件以外は扱えません');
  const h=sh.getRange('A1:F1').getDisplayValues()[0];
  if(cfg.headers.some((x,i)=>h[i]!==x))throw new Error('下書きの形式が違います');
  const row=sh.getRange('A2:F2').getValues()[0],revision=Number(row[1]);
  if(row[0]!==cfg.reportId || row[2]!=='draft' || row[3]!=='draft' ||
     !Number.isInteger(revision) || revision<1)
    throw new Error('架空の未承認記事ではありません');
  let r;
  try{r=JSON.parse(String(row[4]||''));}catch(_){throw new Error('記事のJSONが壊れています');}
  if(!r || r.reportId!==cfg.reportId || r.status!=='draft' ||
     r.source?.type!=='synthetic-test' || r.source?.mode!=='sandbox' ||
     r.approval?.hp?.state!=='draft' || r.approval?.gbp?.state!=='draft' ||
     r.publishLog?.hp!=null || r.publishLog?.gbp!=null ||
     !Array.isArray(r.media) || r.media.length!==0 ||
     !Array.isArray(r.drafts?.hp?.sections))
    throw new Error('実データ・公開済みデータでは操作できません');
  return {sheet:sh,report:r,revision,hp:r.drafts.hp};
}
function oshSandboxReviewRead(){
  const c=oshSandboxReviewReadContext_(),hp=c.hp;
  return {
    reportId:c.report.reportId,revision:c.revision,
    title:hp.titleArea+'の'+hp.titleDevice+' '+hp.titleServices.join('・')+'修理事例',
    description:String(hp.description||'').slice(0,1000),
    sections:hp.sections.slice(0,12).map(s=>({
      heading:String(s.heading||'').slice(0,100),
      paragraphs:(Array.isArray(s.paragraphs)?s.paragraphs:[])
        .slice(0,15).map(v=>String(v).slice(0,1500))
    })),
    review:{state:c.report.sandboxReview?.state||'unreviewed',
            reason:c.report.sandboxReview?.reason||''},
    canPublish:false,photoCount:0
  };
}
function oshSandboxReviewSave(action,expectedRevision,reason){
  if(action!=='confirm' && action!=='return')throw new Error('不正な操作です');
  if(!Number.isInteger(expectedRevision) || expectedRevision<1)
    throw new Error('版番号が不正です');
  if(typeof reason!=='string' || reason.length>500)
    throw new Error('コメントは500文字以内で入力してください');
  const text=reason.trim();
  if(action==='return' && text.length<4)
    throw new Error('差戻し理由を4文字以上入力してください');
  if(action==='confirm' && text!=='')
    throw new Error('確認には差戻し理由を付けられません');
  const lock=LockService.getDocumentLock();
  if(!lock || !lock.tryLock(3000))throw new Error('別の操作中です');
  try{
    const c=oshSandboxReviewReadContext_();
    if(c.revision!==expectedRevision)throw new Error('版が更新されています');
    if(c.report.sandboxReview?.state==='confirmed')throw new Error('確認済みです');
    if(c.report.sandboxReview?.state==='returned')throw new Error('差戻し済みです');
    const at=new Date().toISOString();
    c.report.sandboxReview={
      state:action==='confirm'?'confirmed':'returned',reason:text,at,testOnly:true
    };
    c.sheet.getRange('A2:F2').setValues([[
      c.report.reportId,c.revision+1,'draft','draft',JSON.stringify(c.report),at
    ]]);
    SpreadsheetApp.flush();
    return {state:c.report.sandboxReview.state,revision:c.revision+1,
            canPublish:false};
  }finally{lock.releaseLock();}
}
function oshSandboxReviewOpen(){
  oshSandboxReviewReadContext_();
  const html=HtmlService.createHtmlOutput(
    '<!doctype html><html lang="ja"><head>'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<style>body{font:16px/1.75 system-ui,sans-serif;color:#292929;margin:0;padding:18px}'+
    '.notice{background:#fff1e3;padding:12px;border-radius:12px}'+
    'h2{color:#ed7219;font-size:1.3rem}h3{font-size:1.1rem;margin:20px 0 8px}'+
    'section{border-bottom:1px solid #eee}p{white-space:pre-wrap;overflow-wrap:anywhere}'+
    'button{padding:13px;border:0;border-radius:10px;font:inherit;font-weight:700;cursor:pointer;width:100%;margin:6px 0}'+
    '#confirm{background:#eb741b;color:white}#return{background:#ffe8d4;color:#7b3c0b}'+
    'textarea{box-sizing:border-box;width:100%;min-height:80px;font:inherit;padding:10px}'+
    'button:disabled{opacity:.55}#result{font-weight:700}</style></head><body>'+
    '<div class="notice">架空データ専用：テスト記録のみ。本番承認・HP公開はできません。</div>'+
    '<h2 id="title">読み込み中...</h2><p id="description"></p><div id="sections"></div>'+
    '<p>写真：なし（別工程で検証）</p><div id="controls" hidden>'+
    '<button type="button" id="confirm">確認済みにする（テスト）</button>'+
    '<label for="reason">差戻し理由（4文字以上）</label>'+
    '<textarea id="reason" maxlength="500"></textarea>'+
    '<button type="button" id="return">差し戻す（テスト）</button></div>'+
    '<p id="result" role="status"></p>'+
    '<script>(function(){'+
    'var r;function E(id){return document.getElementById(id)}'+
    'function T(p,t,v){var n=document.createElement(t);n.textContent=String(v||"");p.appendChild(n);return n}'+
    'function show(v){r=v;E("title").textContent=v.title;E("description").textContent=v.description;'+
    'var root=E("sections");root.replaceChildren();v.sections.forEach(function(s){'+
    'var b=T(root,"section","");T(b,"h3",s.heading);s.paragraphs.forEach(function(p){T(b,"p",p)})});'+
    'E("controls").hidden=v.review.state!=="unreviewed";'+
    'E("result").textContent=v.review.state==="confirmed"?"確認済み（テスト）":'+
    '(v.review.state==="returned"?"差戻し済み（テスト）":"内容をご確認ください")}' +
    'function save(action){var reason=action==="return"?E("reason").value.trim():"";'+
    'if(action==="return"&&reason.length<4){E("result").textContent="差戻し理由は4文字以上";return}'+
    'if(!confirm(action==="confirm"?"架空の記事を確認済みにしますか？":"架空の記事を差し戻しますか？"))return;'+
    'E("confirm").disabled=true;E("return").disabled=true;E("result").textContent="保存中...";'+
    'google.script.run.withSuccessHandler(function(v){E("controls").hidden=true;'+
    'E("result").textContent=v.state==="confirmed"?"確認済み（本番未承認）":"差戻しを記録（本番未承認）"}).'+
    'withFailureHandler(function(e){E("confirm").disabled=false;E("return").disabled=false;'+
    'E("result").textContent=e.message||"エラー"}).oshSandboxReviewSave(action,r.revision,reason)}'+
    'E("confirm").onclick=function(){save("confirm")};E("return").onclick=function(){save("return")};'+
    'google.script.run.withSuccessHandler(show).withFailureHandler(function(e){E("result").textContent=e.message||"読込エラー"}).oshSandboxReviewRead();'+
    '})();</script></body></html>'
  ).setWidth(600).setHeight(650);
  SpreadsheetApp.getUi().showModalDialog(html,'オシスマ｜確認・差戻し（合成テスト）');
}
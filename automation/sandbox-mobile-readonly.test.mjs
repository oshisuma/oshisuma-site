import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const code=readFileSync(new URL('./sandbox-mobile-readonly.gs',import.meta.url),'utf8');
const KEY='OSH_SANDBOX_MOBILE_PREVIEW_V1';
function context(options={}){
  const records=new Map();
  const errors=[],writes=[];
  if(options.snapshot!==undefined) records.set(KEY,options.snapshot);
  const props={
    getProperty:k=>k==='OSH_SANDBOX_OWNER_EMAIL'?(options.owner??'owner@example.test'):(records.get(k)||null),
    setProperty:(k,v)=>{writes.push([k,v]);records.set(k,v);}
  };
  const raw={
    reportId:'R-20261118-demo0001',source:{mode:'sandbox',type:'synthetic-test'},
    sandboxReview:{state:'confirmed',testOnly:true},media:[],publishLog:{hp:null,gbp:null}
  };
  if(options.reportEdit)options.reportEdit(raw);
  const ctx=vm.createContext({
    PropertiesService:{getScriptProperties:()=>props},
    Session:{getActiveUser:()=>({getEmail:()=>options.actor??'owner@example.test'})},
    oshSandboxReviewReadContext_:()=>({report:raw,revision:2}),
    oshSandboxReviewRead:()=>({
      reportId:raw.reportId,revision:2,title:'水戸市のiPhone 15画面交換',
      description:'架空の画面修理',sections:[{heading:'修理内容',paragraphs:['画面を交換しました']}],
      review:{state:'confirmed'},photoCount:0,canPublish:false
    }),
    HtmlService:{createHtmlOutput(html){return {html,setTitle(){return this}}}},
    Logger:{log:x=>errors.push(x)},
    Date,JSON,Object,Error,Number,String,Array
  });
  vm.runInContext(code,ctx,{timeout:1000});
  return {ctx,records,writes,errors};
}
function prepared(options={}){
 const e=context(options);
 e.ctx.oshSandboxMobileCaptureSnapshot();
 return e;
}
test('GAS source and embedded browser script parse',()=>{
 const e=prepared(),html=e.ctx.doGet().html;
 assert.doesNotThrow(()=>new vm.Script(code));
 const browser=html.match(/<script>([\s\S]+?)<\/script>/)?.[1];
 assert.ok(browser);assert.doesNotThrow(()=>new vm.Script(browser));
});
test('owner can snapshot an already confirmed synthetic article once and read it without Google Sheets API',()=>{
 const e=prepared();
 assert.equal(e.writes.length,1);
 assert.equal(e.writes[0][0],KEY);
 const payload=JSON.parse(e.records.get(KEY));
 assert.equal(payload.type,'osh-sandbox-mobile-v1');
 assert.equal(payload.reportId,'R-20261118-demo0001');
 assert.equal(payload.review.state,'confirmed');
 const data=e.ctx.oshSandboxMobileRead();
 assert.equal(data.review.state,'confirmed');
 assert.equal(data.canPublish,false);
 assert.equal(data.photoCount,0);
 assert.match(data.title,/iPhone 15/);
 assert.equal(e.writes.length,1);
});
test('owner gate prevents reading and snapshot creation for missing email or another user',()=>{
 for(const options of [{owner:''},{actor:''},{actor:'other@example.test'}]){
  const e=context(options);
  assert.throws(()=>e.ctx.oshSandboxMobileRead());
  assert.throws(()=>e.ctx.oshSandboxMobileCaptureSnapshot());
  assert.equal(e.writes.length,0);
  assert.match(e.ctx.doGet().html,/このページにはアクセスできません/);
 }
});
test('fresh snapshot required and malformed payload rejected',()=>{
 const cases=['','no-json','{}',JSON.stringify({type:'osh-sandbox-mobile-v1',reportId:'wrong'})];
 for(const snapshot of cases){
   const e=context({snapshot});
   assert.throws(()=>e.ctx.oshSandboxMobileRead());
 }
});
test('stale and future-dated snapshots rejected',()=>{
 const e=prepared();
 const snap=JSON.parse(e.records.get(KEY));
 snap.createdAt='2024-01-01T00:00:00.000Z';
 e.records.set(KEY,JSON.stringify(snap));
 assert.throws(()=>e.ctx.oshSandboxMobileRead());
 snap.createdAt='2099-01-01T00:00:00.000Z';
 e.records.set(KEY,JSON.stringify(snap));
 assert.throws(()=>e.ctx.oshSandboxMobileRead());
});
test('published, production, photo and other report prevented from snapshot creation',()=>{
 const changes=[
   r=>r.source.mode='production',r=>r.source.type='google-form',
   r=>r.reportId='other',r=>r.sandboxReview.state='returned',
   r=>r.sandboxReview.testOnly=false,r=>r.media.push({id:'p1'}),
   r=>r.publishLog.hp={published:true},r=>r.publishLog.gbp={published:true}
 ];
 for(const reportEdit of changes){
   const e=context({reportEdit});
   assert.throws(()=>e.ctx.oshSandboxMobileCaptureSnapshot());
   assert.equal(e.writes.length,0);
 }
});
test('no broad spreadsheet scopes, outbound networks, email, deployment or public mutations',()=>{
 assert.doesNotMatch(code,/spreadsheets\.readonly|Sheets\.Spreadsheets|SpreadsheetApp\.openById/);
 assert.doesNotMatch(code,/\b(?:UrlFetchApp|MailApp|GmailApp|DriveApp)\b/);
 assert.doesNotMatch(code,/function\s+doPost\s*\(/);
 assert.doesNotMatch(code,/oshSandboxReviewSave\s*\(/);
 assert.doesNotMatch(code,/\.appendRow\s*\(/);
 assert.doesNotMatch(code,/\.setValues\s*\(/);
});
test('HTML template contains no raw report text, owner email, script property contents or production publish button',()=>{
 const e=prepared(),html=e.ctx.doGet().html;
 assert.match(html,/架空データ専用/);
 assert.doesNotMatch(html,/owner@example\.test|20261118-demo0001|画面を交換しました/);
 assert.match(html,/確認済みにする（テスト）/);
 assert.match(html,/差し戻す（テスト）/);
 assert.doesNotMatch(html,/id="publish"|公開する（本番）/);
});

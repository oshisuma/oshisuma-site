import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('./sandbox-review-actions.gs',import.meta.url),'utf8');
const ID='1JB-duIYGsyzSzJXEdHB5SAqRJkQFtxeYmWmXBWm5P-I';
const NAME='オシスマ_修理事例自動化_合成テスト専用_20261118';
const REPORT='R-20261118-demo0001';
const HEAD=['報告ID','版','HP','Google','報告データ（JSON）','更新日時'];
const makeReport=()=>({
 reportId:REPORT,status:'draft',source:{type:'synthetic-test',mode:'sandbox'},
 approval:{hp:{state:'draft'},gbp:{state:'draft'}},publishLog:{hp:null,gbp:null},
 media:[],drafts:{hp:{titleArea:'水戸市',titleDevice:'iPhone 15',
 titleServices:['画面交換'],description:'架空の修理報告',
 sections:[{heading:'対応内容',paragraphs:['画面を交換しました']}]}},
});
function env({id=ID,name=NAME,extraRow=false,change,lockOk=true}={}){
 const report=makeReport();if(change)change(report);
 let row=[REPORT,1,'draft','draft',JSON.stringify(report),'2026-11-18T09:25:00Z'];
 const writes=[],events=[];
 const sheet={
   getLastRow(){return extraRow?3:2},
   getRange(range){
     if(range==='A1:F1')return {getDisplayValues(){return [HEAD]}};
     if(range==='A2:F2')return {getValues(){return [[...row]]},
       setValues(values){row=[...values[0]];writes.push(values[0])}};
     throw Error('Unexpected range '+range);
   }
 };
 const ss={getId:()=>id,getName:()=>name,
   getSheetByName:n=>n==='下書き'?sheet:null};
 const ctx=vm.createContext({
  SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush(){events.push('flush')},
   getUi(){return {showModalDialog(html,title){events.push({html,title})}}}},
  LockService:{getDocumentLock(){return {
    tryLock(){return lockOk},releaseLock(){events.push('released')}
  }}},
  HtmlService:{createHtmlOutput(html){return {
    html,setWidth(){return this},setHeight(){return this}
  }}},
  Date,JSON,Error,Number,String,Array,Object
 });
 vm.runInContext(script,ctx,{timeout:1000});
 return {ctx,writes,events,row:()=>row,report:()=>JSON.parse(row[4])};
}
test('GAS and modal script have valid syntax',()=>{
 assert.doesNotThrow(()=>new vm.Script(script));
 const e=env();e.ctx.oshSandboxReviewOpen();
 const html=e.events.find(v=>v.html)?.html?.html;
 assert.ok(html);
 const js=html.match(/<script>([\s\S]+?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new vm.Script(js));
});
test('reading synthetic case never writes',()=>{
 const e=env(),data=e.ctx.oshSandboxReviewRead();
 assert.match(data.title,/iPhone 15/);
 assert.equal(data.canPublish,false);assert.equal(e.writes.length,0);
});
test('unexpected spreadsheet is rejected',()=>{
 for(const options of [{id:'wrong'},{name:'production'},{extraRow:true}]){
  const e=env(options);
  assert.throws(()=>e.ctx.oshSandboxReviewRead());
  assert.equal(e.writes.length,0);
 }
});
test('production, approved, published or media content is rejected',()=>{
 const changes=[
  r=>r.source.mode='production',r=>r.source.type='google-form',
  r=>r.approval.hp.state='approved',r=>r.approval.gbp.state='approved',
  r=>r.publishLog.hp={publishedAt:'now'},r=>r.publishLog.gbp={publishedAt:'now'},
  r=>r.media.push({id:'p1'}),r=>{r.drafts.hp.sections=null}
 ];
 for(const change of changes){
  const e=env({change});assert.throws(()=>e.ctx.oshSandboxReviewSave('confirm',1,''));
  assert.equal(e.writes.length,0);
 }
});
test('confirm records review but cannot grant real HP or Google approval',()=>{
 const e=env(),result=e.ctx.oshSandboxReviewSave('confirm',1,'');
 assert.equal(result.state,'confirmed');assert.equal(result.canPublish,false);
 assert.equal(e.writes.length,1);assert.equal(e.row()[1],2);
 assert.equal(e.row()[2],'draft');assert.equal(e.row()[3],'draft');
 assert.equal(e.report().approval.hp.state,'draft');
 assert.equal(e.report().approval.gbp.state,'draft');
 assert.equal(e.report().publishLog.hp,null);
});
test('return requires a reason and does not publish',()=>{
 const e=env();assert.throws(()=>e.ctx.oshSandboxReviewSave('return',1,'短'));
 assert.equal(e.writes.length,0);
 const r=e.ctx.oshSandboxReviewSave('return',1,'修理後の説明を追加');
 assert.equal(r.state,'returned');assert.equal(e.report().sandboxReview.testOnly,true);
 assert.equal(e.row()[2],'draft');
});
test('unsupported action and unexpected reason are rejected',()=>{
 const e=env();
 assert.throws(()=>e.ctx.oshSandboxReviewSave('publish',1,''));
 assert.throws(()=>e.ctx.oshSandboxReviewSave('confirm',1,'コメント'));
 assert.equal(e.writes.length,0);
});
test('stale revision and repeat actions cannot rewrite',()=>{
 const e=env();e.ctx.oshSandboxReviewSave('confirm',1,'');
 assert.throws(()=>e.ctx.oshSandboxReviewSave('confirm',1,''));
 assert.throws(()=>e.ctx.oshSandboxReviewSave('return',2,'内容を直す'));
 assert.equal(e.writes.length,1);
});
test('returned state cannot subsequently be confirmed',()=>{
 const e=env();e.ctx.oshSandboxReviewSave('return',1,'修理後の説明を追加');
 assert.throws(()=>e.ctx.oshSandboxReviewSave('confirm',2,''));
 assert.equal(e.writes.length,1);
});
test('lock rejection never writes',()=>{
 const e=env({lockOk:false});
 assert.throws(()=>e.ctx.oshSandboxReviewSave('confirm',1,''));
 assert.equal(e.writes.length,0);
});
test('no deploy, email, AI, public API or Drive access',()=>{
 assert.doesNotMatch(script,/\bfunction\s+(?:doGet|doPost)\s*\(/);
 assert.doesNotMatch(script,/\b(?:UrlFetchApp|DriveApp|GmailApp|MailApp)\b/);
 assert.doesNotMatch(script,/setProperty\s*\(/);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('./sandbox-mobile-readonly.gs',import.meta.url),'utf8');
const ID='1JB-duIYGsyzSzJXEdHB5SAqRJkQFtxeYmWmXBWm5P-I';
const NAME='オシスマ_修理事例自動化_合成テスト専用_20261118';
const HEAD=['報告ID','版','HP','Google','報告データ（JSON）','更新日時'];
function fixture(){
 return {
   reportId:'R-20261118-demo0001',status:'draft',
   source:{type:'synthetic-test',mode:'sandbox'},
   media:[],approval:{hp:{state:'draft'},gbp:{state:'draft'}},
   publishLog:{hp:null,gbp:null},
   sandboxReview:{state:'confirmed',reason:'',at:'2026-11-18T10:18:54.989Z',testOnly:true},
   drafts:{hp:{titleArea:'水戸市',titleDevice:'iPhone 15',titleServices:['画面交換'],
     description:'架空の記事です',sections:[{heading:'ご相談',paragraphs:['画面割れ']}]} }
 };
}
function environment(options={}){
 const calls=[],report=fixture();
 if(options.change)options.change(report);
 const rows=options.rows||[HEAD,['R-20261118-demo0001','2','draft','draft',JSON.stringify(report),'2026-11-18T10:18:54.989Z']];
 const sheets={
  Spreadsheets:{
   get(id,opts){calls.push(['meta',id,opts]);return {
     spreadsheetId:options.id??ID,properties:{title:options.title??NAME}
   }},
   Values:{get(id,range,opts){calls.push(['range',id,range,opts]);return {values:rows}}}
  }
 };
 const htmls=[];
 const ctx=vm.createContext({
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>
    key==='OSH_SANDBOX_OWNER_EMAIL'?(options.allowed??'owner@example.test'):''
  })},
  Session:{getActiveUser:()=>({getEmail:()=>options.actor??'owner@example.test'})},
  Sheets:options.missingService?undefined:sheets,
  HtmlService:{createHtmlOutput(html){htmls.push(html);return {html,setTitle(){return this}}}},
  JSON,Error,String,Object,Number,Array
 });
 vm.runInContext(script,ctx,{timeout:1000});
 return {ctx,calls,htmls};
}
test('server code has valid syntax',()=>{
 assert.doesNotThrow(()=>new vm.Script(script));
});
test('synthetic-only owner can read confirmed article without any writes',()=>{
 const e=environment(),data=e.ctx.oshSandboxMobileRead();
 assert.match(data.title,/水戸市.*iPhone 15/);
 assert.equal(data.revision,2);
 assert.equal(data.review.state,'confirmed');
 assert.equal(data.canPublish,false);
 assert.equal(data.photoCount,0);
 assert.deepEqual(e.calls.map(c=>c[0]),['meta','range']);
 assert.equal(e.calls[1][2],"'下書き'!A1:F100");
});
test('no owner configured, missing active user, or another account blocks before any API calls',()=>{
 for(const opt of [{allowed:''},{actor:''},{actor:'another@example.test'}]){
  const e=environment(opt);
  assert.throws(()=>e.ctx.oshSandboxMobileRead());
  assert.equal(e.calls.length,0);
  const page=e.ctx.doGet();
  assert.match(page.html,/アクセスできません/);
  assert.equal(e.calls.length,0);
 }
});
test('all file identity, header, and record-quantity changes fail closed',()=>{
 const cases=[
  {id:'different'}, {title:'production'},
  {rows:[HEAD]},
  {rows:[HEAD,['R-20261118-demo0001','2','draft','draft','{}'],['extra']]},
  {rows:[['wrong'],['R-20261118-demo0001','2','draft','draft','{}']]}
 ];
 for(const opt of cases){
  const e=environment(opt);
  assert.throws(()=>e.ctx.oshSandboxMobileRead());
 }
});
test('data from production or any approved/published/photo-bearing case is refused',()=>{
 const changes=[
  r=>r.source.mode='production',
  r=>r.source.type='google-form',
  r=>r.approval.hp.state='approved',
  r=>r.approval.gbp.state='approved',
  r=>r.publishLog.hp={published:true},
  r=>r.publishLog.gbp={published:true},
  r=>r.media.push({id:'p1'}),
  r=>{r.drafts.hp.sections=null},
  r=>{r.sandboxReview.testOnly=false},
  r=>{r.sandboxReview.state='published'}
 ];
 for(const change of changes){
  const e=environment({change});
  assert.throws(()=>e.ctx.oshSandboxMobileRead());
 }
});
test('missing or unconfigured Sheets Advanced Service is a safe failure',()=>{
 const e=environment({missingService:true});
 assert.throws(()=>e.ctx.oshSandboxMobileRead());
});
test('successful owner page embeds no raw report body or identifiers',()=>{
 const e=environment();
 const page=e.ctx.doGet();
 assert.match(page.html,/架空データ専用/);
 assert.doesNotMatch(page.html,/20261118-demo0001/);
 assert.doesNotMatch(page.html,/owner@example.test/);
 assert.doesNotMatch(page.html,/onclick=/);
 assert.doesNotMatch(page.html,/oshSandboxReviewSave/);
 const client=page.html.match(/<script>([\s\S]+?)<\/script>/)?.[1];
 assert.ok(client);
 assert.doesNotThrow(()=>new vm.Script(client));
});
test('no mutation, emails, AI transfer, or unexpected execution entrypoints',()=>{
 assert.doesNotMatch(script,/\b(?:appendRow|setValues|setValue|UrlFetchApp|GmailApp|MailApp|DriveApp|LockService)\b/);
 assert.doesNotMatch(script,/function\s+doPost\s*\(/);
 assert.doesNotMatch(script,/oshSandboxReviewSave\s*\(/);
});
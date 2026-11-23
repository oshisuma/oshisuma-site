import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const mobile=readFileSync(new URL('./sandbox-mobile-readonly.gs',import.meta.url),'utf8');
const actions=readFileSync(new URL('./sandbox-mobile-actions.gs',import.meta.url),'utf8');
const returning=readFileSync(new URL('./sandbox-mobile-return-case.gs',import.meta.url),'utf8');
const page=readFileSync(new URL('./sandbox-mobile-return-page.gs',import.meta.url),'utf8');
const SNAP='OSH_SANDBOX_MOBILE_PREVIEW_V1',CONFIRM='OSH_SANDBOX_MOBILE_ACTION_V1',RET='OSH_SANDBOX_MOBILE_RETURN_V1';
function setup(options={}){
  const records=new Map([
    [SNAP,JSON.stringify({type:'osh-sandbox-mobile-v1',reportId:'R-20261118-demo0001',revision:2,title:'架空iPhone',description:'架空',sections:[],review:{state:'confirmed'},photoCount:0,canPublish:false,createdAt:new Date().toISOString()})],
    [CONFIRM,JSON.stringify({type:'osh-sandbox-mobile-action-v1',reportId:'R-20261118-demo0001',sourceRevision:2,sourceTag:'2@'+new Date().toISOString(),state:'confirmed',reason:'',at:new Date().toISOString(),testOnly:true,canPublish:false})]
  ]);
  const writes=[];
  let locked=false;
  const lock={tryLock:()=>!options.lockFail&&!locked&&(locked=true),releaseLock:()=>{locked=false}};
  const props={getProperty:k=>k==='OSH_SANDBOX_OWNER_EMAIL'?(options.owner??'owner@example.test'):records.get(k)||null,setProperty:(k,v)=>{writes.push([k,v]);records.set(k,v)}};
  const ctx=vm.createContext({
   PropertiesService:{getScriptProperties:()=>props},
   Session:{getActiveUser:()=>({getEmail:()=>options.actor===undefined?'owner@example.test':options.actor})},
   LockService:{getScriptLock:()=>lock},
   HtmlService:{createHtmlOutput:html=>({html,setTitle(){return this}})},
   Logger:{log(){}},Date,JSON,Object,Number,String,Array,Error
  });
  for(const source of [mobile,actions,returning,page])vm.runInContext(source,ctx);
  return {ctx,records,writes};
}
test('separate synthetic iPad case is pending; existing iPhone approval record untouched',()=>{
 const t=setup(),before=t.records.get(CONFIRM);
 const state=t.ctx.oshSandboxReturnRead();
 assert.equal(state.state,'pending');assert.equal(state.testOnly,true);
 assert.equal(state.canPublish,false);assert.equal(state.photoCount,0);
 assert.match(state.title,/iPad/);
 assert.equal(t.records.get(CONFIRM),before);assert.equal(t.writes.length,0);
});
test('return page route is separate and its embedded script parses',()=>{
 const t=setup(),html=t.ctx.doGet({parameter:{mode:'return'}}).html;
 assert.match(html,/差し戻しを記録する（テスト）/);
 assert.doesNotMatch(html,/内容を確認済みにする/);
 const browser=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(browser);assert.doesNotThrow(()=>new vm.Script(browser));
 assert.match(t.ctx.doGet({parameter:{}}).html,/iPhone|内容を確認済みにする/);
});
test('return persists once without changing existing confirmed iPhone action',()=>{
 const t=setup(),old=t.records.get(CONFIRM),original=t.records.get(SNAP);
 const state=t.ctx.oshSandboxReturnRead();
 const updated=t.ctx.oshSandboxReturnSave(state.sourceTag,'修理内容をもっと詳しく記載してください');
 assert.equal(updated.state,'returned');
 assert.equal(updated.reason,'修理内容をもっと詳しく記載してください');
 assert.equal(t.writes.length,1);assert.equal(t.writes[0][0],RET);
 assert.equal(t.records.get(CONFIRM),old);assert.equal(t.records.get(SNAP),original);
 assert.equal(t.ctx.oshSandboxReturnRead().state,'returned');
 assert.throws(()=>t.ctx.oshSandboxReturnSave(state.sourceTag,'別の理由を登録する'));
});
test('invalid reason, tag, wrong account, lock fail are denied without writes',()=>{
 for(const fail of [
   t=>t.ctx.oshSandboxReturnSave('not-current','理由は十分長いです'),
   t=>t.ctx.oshSandboxReturnSave(t.ctx.oshSandboxReturnRead().sourceTag,'短'),
   t=>t.ctx.oshSandboxReturnSave(t.ctx.oshSandboxReturnRead().sourceTag,'a'.repeat(301))
 ]){const t=setup();assert.throws(()=>fail(t));assert.equal(t.writes.length,0);}
 for(const options of [{actor:'someone@example.test'},{actor:''},{owner:''},{lockFail:true}]){
   const t=setup(options);
   if(!options.lockFail)assert.throws(()=>t.ctx.oshSandboxReturnRead());
   assert.throws(()=>t.ctx.oshSandboxReturnSave('synthetic-return-v1@R-20261119-demo-return0001@1','もっと説明してください'));
   assert.equal(t.writes.length,0);
 }
});
test('corrupt stored return record is rejected and not overwritten',()=>{
 const t=setup();t.records.set(RET,JSON.stringify({state:'confirmed'}));
 assert.throws(()=>t.ctx.oshSandboxReturnRead());
 assert.throws(()=>t.ctx.oshSandboxReturnSave('synthetic-return-v1@R-20261119-demo-return0001@1','修正してください'));
 assert.equal(t.writes.length,0);
});
test('return-only files contain no broad scopes, sheet access, external API or publish',()=>{
 for(const file of [returning,page]){
  assert.doesNotMatch(file,/SpreadsheetApp|DriveApp|UrlFetchApp|MailApp|GmailApp|Sheets\.Spreadsheets|\.appendRow|\.setValues|ScriptApp\.newTrigger/);
 }
 assert.match(returning,/OSH_SANDBOX_MOBILE_RETURN_V1/);
 assert.match(returning,/getScriptLock\(\)/);
 assert.match(returning,/oshSandboxMobileOwner_\(\)/);
 assert.doesNotMatch(page,/id="confirm"|id="publish"/);
});

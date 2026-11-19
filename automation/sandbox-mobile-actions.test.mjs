import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const mobile=readFileSync(new URL('./sandbox-mobile-readonly.gs',import.meta.url),'utf8');
const actions=readFileSync(new URL('./sandbox-mobile-actions.gs',import.meta.url),'utf8');
const SNAP='OSH_SANDBOX_MOBILE_PREVIEW_V1';
const ACTION='OSH_SANDBOX_MOBILE_ACTION_V1';
function setup(opt={}){
  const now=new Date().toISOString();
  const source={
    type:'osh-sandbox-mobile-v1',reportId:'R-20261118-demo0001',
    revision:2,title:'架空のiPhone修理',description:'テスト専用',
    sections:[{heading:'作業',paragraphs:['架空の画面交換です']}],
    photoCount:0,canPublish:false,review:{state:'confirmed'},createdAt:now
  };
  if(opt.editSource)opt.editSource(source);
  const records=new Map([[SNAP,JSON.stringify(source)]]);
  const writes=[];
  if(opt.preExisting)records.set(ACTION,JSON.stringify(opt.preExisting));
  const p={
    getProperty:k=>k==='OSH_SANDBOX_OWNER_EMAIL'?(opt.owner===undefined?'owner@example.test':opt.owner):records.get(k)||null,
    setProperty:(k,v)=>{writes.push([k,v]);records.set(k,v)}
  };
  let lockHeld=false;
  const lock={tryLock:()=>!opt.lockFail&&!lockHeld&&(lockHeld=true),releaseLock:()=>{lockHeld=false}};
  const c=vm.createContext({
    PropertiesService:{getScriptProperties:()=>p},
    Session:{getActiveUser:()=>({getEmail:()=>opt.actor===undefined?'owner@example.test':opt.actor})},
    LockService:{getScriptLock:()=>lock},
    HtmlService:{createHtmlOutput:html=>({html,setTitle(){return this}})},
    Date,JSON,Object,Number,String,Array,Error,Logger:{log(){}},
    oshSandboxReviewReadContext_:()=>{throw new Error('Never access Sheets during mobile action')}
  });
  vm.runInContext(mobile,c);
  vm.runInContext(actions,c);
  return {c,records,writes,source};
}

test('mobile action API parses, reads pending record, preserves synthetic no-publish setting',()=>{
 const {c,writes}=setup();
 const state=c.oshSandboxMobileReviewState();
 assert.equal(state.state,'pending');
 assert.equal(state.testOnly,true);
 assert.equal(state.canPublish,false);
 assert.equal(writes.length,0);
 assert.match(c.doGet().html,/確認済みにする（テスト）/);
 const browser=c.doGet().html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(browser);assert.doesNotThrow(()=>new vm.Script(browser));
});
test('confirmation stores only isolated action record, once, with expected tag',()=>{
 const t=setup(),before=t.c.oshSandboxMobileReviewState();
 const done=t.c.oshSandboxMobileReviewSave('confirm',before.sourceTag,'');
 assert.equal(done.state,'confirmed');
 assert.equal(done.canPublish,false);
 assert.equal(t.writes.length,1);
 assert.equal(t.writes[0][0],ACTION);
 assert.equal(t.records.get(SNAP),JSON.stringify(t.source));
 assert.equal(t.c.oshSandboxMobileReviewState().state,'confirmed');
 assert.throws(()=>t.c.oshSandboxMobileReviewSave('return',before.sourceTag,'修理内容確認'));
 assert.equal(t.writes.length,1);
});
test('return requires reason and stores reason without other writes',()=>{
 const t=setup(),state=t.c.oshSandboxMobileReviewState();
 assert.throws(()=>t.c.oshSandboxMobileReviewSave('return',state.sourceTag,'短'));
 assert.throws(()=>t.c.oshSandboxMobileReviewSave('confirm',state.sourceTag,'文章'));
 const done=t.c.oshSandboxMobileReviewSave('return',state.sourceTag,'修理内容を修正してください');
 assert.equal(done.state,'returned');
 assert.equal(done.reason,'修理内容を修正してください');
 assert.equal(t.writes.length,1);
 assert.equal(t.writes[0][0],ACTION);
});
test('owner mismatch, missing owner or blank active user always denies mutations',()=>{
 for(const opt of [{actor:'other@example.test'},{actor:''},{owner:''}]){
   const t=setup(opt);
   assert.throws(()=>t.c.oshSandboxMobileReviewState());
   assert.throws(()=>t.c.oshSandboxMobileReviewSave('confirm','2@'+t.source.createdAt,''));
   assert.equal(t.writes.length,0);
 }
});
test('old tag, unknown action and stale source fail closed',()=>{
 const t=setup(),state=t.c.oshSandboxMobileReviewState();
 assert.throws(()=>t.c.oshSandboxMobileReviewSave('confirm','2@2000-01-01T00:00:00.000Z',''));
 assert.throws(()=>t.c.oshSandboxMobileReviewSave('publish',state.sourceTag,''));
 assert.equal(t.writes.length,0);
 const stale=setup({editSource:s=>s.createdAt='2020-01-01T00:00:00.000Z'});
 assert.throws(()=>stale.c.oshSandboxMobileReviewState());
 assert.equal(stale.writes.length,0);
});
test('lock failure, invalid snapshot and corrupted action state fail closed',()=>{
 const locked=setup({lockFail:true});
 const state=locked.c.oshSandboxMobileReviewState();
 assert.throws(()=>locked.c.oshSandboxMobileReviewSave('confirm',state.sourceTag,''));
 assert.equal(locked.writes.length,0);
 const invalid=setup({editSource:s=>s.canPublish=true});
 assert.throws(()=>invalid.c.oshSandboxMobileReviewState());
 assert.equal(invalid.writes.length,0);
 const corrupted=setup({preExisting:{foo:1}});
 assert.throws(()=>corrupted.c.oshSandboxMobileReviewState());
 assert.equal(corrupted.writes.length,0);
});
test('no sheet writes, external API, broad scopes, public publishing, or auth bypass',()=>{
 assert.doesNotMatch(actions,/SpreadsheetApp|DriveApp|UrlFetchApp|GmailApp|MailApp|Sheets\.Spreadsheets|\.setValues|\.appendRow/);
 assert.doesNotMatch(actions,/oshSandboxReviewSave|ScriptApp\.newTrigger|deploy|Cloudflare|fetch\s*\(/i);
 assert.match(actions,/oshSandboxMobileOwner_\(\)/);
 assert.match(actions,/getScriptLock\(\)/);
 assert.match(actions,/canPublish:false/);
});

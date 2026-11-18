import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./legacy-safe-sync.gs',import.meta.url),'utf8');
const id='R-20261118-1234abcd';
const report=()=>({reportId:id,status:'needs-draft',source:{mode:'production'},
  drafts:{hp:null,gbp:null},approval:{hp:{state:'draft'}},publishLog:{hp:null}});
function setup({on=false,owner=true,held=false,stale=false,old=false,throws=false}={}){
 const properties=new Map(Object.entries({
  OSH_LEGACY_SYNC_ENABLED:String(on),
  OSH_LEGACY_SYNC_START_AFTER:'2026-11-18T00:00:00+09:00',
  OSH_LEGACY_SYNC_MAX_PER_TICK:'2',
  HOLD_REPORT_IDS:held?id:''
 }));
 const row={report:report(),revision:1},calls={read:0,write:0,owner:0};
 const f={name:id+'.json',updated:old?'2026-11-17T00:00:00Z':'2026-11-18T01:00:00Z',
 data:{reportId:id},older:false};
 if(stale)f.data.reportId='R-20261117-1234abcd';
 const ctx=vm.createContext({
  PropertiesService:{getScriptProperties:()=>({
   getProperty:k=>properties.get(k)??null,
   setProperty:(k,v)=>properties.set(k,v)
  })},
  requireApprover_:()=>{calls.owner++;if(!owner)throw Error('not owner');return 'owner'},
  withLock_:fn=>fn(),
  readDrafts_:()=>{calls.read++;return [row]},
  readDraftFiles_:()=>[f],
  loadDraft_:(rows,payload,meta,user,out)=>{
   if(throws)throw Error('mock failure');
   calls.write++;out.applied.push(payload.reportId);
  },
  CONFIG:{MODE:'production'},Logger:{log:()=>{}}
 });
 vm.runInContext(code,ctx,{timeout:1000});
 return {run:()=>vm.runInContext('oshLegacySafeSyncTick()',ctx,{timeout:1000}),ctx,properties,calls,row};
}
test('default disabled does not read or change data',()=>{
 const x=setup();assert.equal(x.run().state,'disabled');assert.equal(x.calls.read,0);
});
test('only authorized owner can initiate sync',()=>{
 const x=setup({on:true,owner:false});assert.throws(()=>x.run(),/not owner/);assert.equal(x.calls.read,0);
});
test('new valid draft is passed to legacy sync once',()=>{
 const x=setup({on:true});assert.equal(x.run().applied,1);assert.equal(x.calls.write,1);
});
test('held cases are never imported automatically',()=>{
 const x=setup({on:true,held:true});assert.equal(x.run().applied,0);
});
test('old file timestamp is excluded',()=>{
 const x=setup({on:true,old:true});assert.equal(x.run().applied,0);
});
test('file/report ID mismatch prevents sync',()=>{
 const x=setup({on:true,stale:true});assert.equal(x.run().applied,0);
});
test('already completed report never gets overwritten',()=>{
 const x=setup({on:true});x.row.report.drafts.hp={title:'already present'};
 assert.equal(x.run().applied,0);
});
test('failed existing import is halted against automatic retries',()=>{
 const x=setup({on:true,throws:true});assert.throws(()=>x.run(),/停止/);
 assert.equal(x.properties.get('OSH_LEGACY_SYNC_HALTED'),'true');
 assert.throws(()=>x.run(),/以前の自動同期エラー/);
});
test('review inbox excludes reports without AI drafts',()=>{
 const x=setup({on:true});const inbox=vm.runInContext('oshLegacyReviewInbox()',x.ctx);
 assert.equal(inbox.length,0);
});

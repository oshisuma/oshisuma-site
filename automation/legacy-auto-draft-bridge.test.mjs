import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./legacy-auto-draft-bridge.gs',import.meta.url),'utf8');
const id='R-20261118-1234abcd';
const row=()=>({
 reportId:id,source:{mode:'production',key:'sent_x'},status:'needs-draft',
 intake:{reportText:'画面割れ、交換後は動作確認済み'},
 facts:{area:{name:'水戸市',slug:'mito'},device:{name:'iPhone 15',slug:'iphone15'},uncertain:[]},
 media:[{id:'p1',privacyCheck:'pending',contentMatch:'pending'}],
 drafts:{hp:null},approval:{hp:{state:'draft'}},publishLog:{hp:null}
});
function harness({enabled=false,permission=false,owner=true,completed=false,privateInfo=false,aiIncomplete=false,created=false,valid=true}={}){
 const p=new Map(Object.entries({
 OSH_LEGACY_AUTO_DRAFT_ENABLED:String(enabled),
 AI_DATA_SHARING_APPROVED:String(permission),
 OSH_LEGACY_AI_START_AFTER:'2026-11-18T00:00:00Z',
 ANTHROPIC_API_KEY:'dummy-only-test',ANTHROPIC_MODEL:'fake',
 EXCHANGE_IDS:JSON.stringify({intake:'intake-id',drafts:'drafts-id'})
 }));
 const calls={ai:0,files:0,apiBudget:0};
 const r=row();
 if(completed)r.drafts.hp={slug:'old'};
 if(privateInfo){r.intake.reportText='お客様の住所は茨城町1丁目';r.facts.uncertain.push('住所が記載');}
 const context=vm.createContext({
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>p.get(k)??null,setProperty:(k,v)=>p.set(k,v)})},
 CONFIG:{MODE:'production'},
 requireApprover_:()=>{if(!owner)throw Error('本人確認不可')},
 readDrafts_:()=>[{report:r}],
 readDraftFiles_:()=>created?[{data:{reportId:id}}]:[],
 oshAutoGenerate_:()=>{calls.ai++;return {ready:!aiIncomplete}},
 oshAutoBudget_:()=>{calls.apiBudget++;return true},
 oshLegacyCreateDraftPatch_:(_r,ai)=>ai.ready?{reportId:id,drafts:{hp:{},gbp:{}}}:null,
 applyDraft_:()=>valid?[]:['invalid'],
 createFile_:()=>{calls.files++},
 jsonBlob_:()=>({}),
 Drive:{Files:{list:()=>({files:[{id:'drive-file',name:id+'.json',createdTime:'2026-11-18T05:00:00Z'}]})}},
 DriveApp:{getFileById:()=>({getBlob:()=>({getDataAsString:()=>JSON.stringify(r)})})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
 Utilities:{formatDate:()=> '2026-11-18'},
 Logger:{log:()=>{}},Date
 });
 vm.runInContext(code,context,{timeout:1000});
 return {run:()=>vm.runInContext('oshLegacyAutoDraftTick()',context,{timeout:1000}),calls,p};
}
test('default disabled sends no AI requests and writes no files',()=>{
 const x=harness();assert.equal(x.run().status,'disabled');assert.equal(x.calls.ai,0);
});
test('explicit approval is required before any AI request',()=>{
 const x=harness({enabled:true});assert.throws(()=>x.run(),/許可がありません/);assert.equal(x.calls.ai,0);
});
test('owner verification cannot be bypassed',()=>{
 const x=harness({enabled:true,permission:true,owner:false});
 assert.throws(()=>x.run(),/本人確認/);assert.equal(x.calls.ai,0);
});
test('only a fresh legacy imported report can be converted and saved',()=>{
 const x=harness({enabled:true,permission:true});
 assert.equal(x.run().generated,1);assert.equal(x.calls.ai,1);assert.equal(x.calls.files,1);
});
test('an already generated draft is not regenerated',()=>{
 const x=harness({enabled:true,permission:true,created:true});
 assert.equal(x.run().generated,0);assert.equal(x.calls.ai,0);
});
test('existing content is not regenerated over a completed report',()=>{
 const x=harness({enabled:true,permission:true,completed:true});
 assert.equal(x.run().generated,0);assert.equal(x.calls.ai,0);
});
test('potential personal data is held from external AI',()=>{
 const x=harness({enabled:true,permission:true,privateInfo:true});
 assert.equal(x.run().generated,0);assert.equal(x.calls.ai,0);
 assert.equal(x.p.get('OSH_LEGACY_AI_HOLD_'+id),'true');
});
test('advice-only or incomplete repair is held and produces no draft',()=>{
 const x=harness({enabled:true,permission:true,aiIncomplete:true});
 assert.equal(x.run().generated,0);assert.equal(x.calls.files,0);
 assert.equal(x.p.get('OSH_LEGACY_AI_HOLD_'+id),'true');
});
test('failed existing-schema validation halts further runs',()=>{
 const x=harness({enabled:true,permission:true,valid:false});
 assert.throws(()=>x.run(),/停止/);
 assert.equal(x.calls.files,0);
 assert.equal(x.p.get('OSH_LEGACY_AUTO_DRAFT_HALTED'),'true');
 assert.throws(()=>x.run(),/前回の異常/);
});
test('a report with missing historical timestamp is rejected before the AI call',()=>{
 const x=harness({enabled:true,permission:true});
 x.p.set('OSH_LEGACY_AI_START_AFTER','not-a-date');
 assert.throws(()=>x.run(),/設定が不足/);assert.equal(x.calls.ai,0);
});

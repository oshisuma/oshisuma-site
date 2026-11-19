import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./legacy-readonly-preflight.gs',import.meta.url),'utf8');
const headings={
 drafts:['報告ID','版','HP','Google','報告データ（JSON）','更新日時'],
 ledger:['報告キー','報告ID','回答の行','報告日時','取り込み日時','担当スタッフ（非公開）'],
 log:['日時','操作した人','報告ID','対象','操作','内容']
};
function fakeSheet(values){
 return {
 getLastColumn:()=>values.length,
 getRange:()=>({getValues:()=>[values]})
 };
}
function setup({authorized=true,changedHeaders=false,missingFolder=false,triggerOn=false,noFolderIds=false,responseLastRow=99}={}){
 const p=new Map(Object.entries({
 OSH_LEGACY_AUTO_IMPORT_ENABLED:triggerOn?'true':'false',
 OSH_LEGACY_AUTO_DRAFT_ENABLED:'false',
 AI_DATA_SHARING_APPROVED:'false',
 EXCHANGE_IDS:noFolderIds?'':JSON.stringify({
 root:'root-012345',intake:'intake-012345',drafts:'drafts-012345',
 photos:'photos-012345',approved:'approved-012345'}),
 OSH_LEGACY_AUTO_START_ROW:'100',OSH_LEGACY_AI_START_AFTER:'2026-11-18T12:00:00+09:00',
 ANTHROPIC_MODEL:'test-model',ANTHROPIC_API_KEY:'SECRET'
 }));
 const folderName={root:'オシスマ_修理事例_受け渡し',intake:'intake',drafts:'drafts',photos:'photos',approved:'approved'};
 const calls={writes:0,folders:0,reads:0};
 const book={
 getSheetByName:name=>{
 const k=name==='下書き'?'drafts':name==='取り込み済み'?'ledger':'log';
 return fakeSheet(changedHeaders&&k==='ledger'?['WRONG',...headings[k].slice(1)]:headings[k]);
 }};
 const ctx=vm.createContext({
 CONFIG:{MODE:'production',EXCHANGE_FOLDER_NAME:folderName.root},
 TAB_DRAFTS:'下書き',TAB_LEDGER:'取り込み済み',TAB_LOG:'操作の記録',
 DRAFT_HEADERS:headings.drafts,IMPORT_HEADERS:headings.ledger,LOG_HEADERS:headings.log,
 requireApprover_:()=>{if(!authorized)throw Error('権限なし')},
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>p.get(k)??null})},
 book_:()=>book,
 responseSheet_:()=>{calls.reads++;return {...fakeSheet(['タイムスタンプ','機種','修理内容','写真']), getLastRow:()=>responseLastRow}},
 getLayout_:()=>({map:{timestamp:[0],model:[1],details:[2],photos:[3]}}),
 Drive:{Files:{get:(id)=>{
 calls.reads++;const which=id.split('-')[0];
 if(missingFolder&&which==='photos')throw Error('not found');
 return {name:folderName[which],mimeType:'application/vnd.google-apps.folder',trashed:false};
 }}},
 Logger:{log:()=>{}}
 });
 vm.runInContext(code,ctx,{timeout:1000});
 return {call:()=>vm.runInContext('oshLegacyReadOnlyPreflight()',ctx,{timeout:1000}),calls,p};
}
test('diagnosis is read-only and never approves production',()=>{
 const x=setup(),out=x.call();
 assert.equal(out.mode,'read-only');assert.equal(out.productionApproved,false);
 assert.equal(out.readyForReview,true);assert.equal(x.calls.writes,0);
});
test('caller must be logged in as approver before any access',()=>{
 const x=setup({authorized:false});assert.throws(()=>x.call(),/権限なし/);
 assert.equal(x.calls.reads,0);
});
test('unexpected existing management headers are reported',()=>{
 const x=setup({changedHeaders:true});const r=x.call();
 assert.equal(r.readyForReview,false);
 assert.equal(r.items.find(y=>y.key==='management-ledger').ok,false);
});
test('missing photo folder is diagnosed without creating any folder',()=>{
 const x=setup({missingFolder:true});const r=x.call();
 assert.equal(r.items.find(y=>y.key==='folder-photos').ok,false);assert.equal(x.calls.folders,0);
});
test('missing stored folder IDs never invokes folder creation',()=>{
 const x=setup({noFolderIds:true});const r=x.call();
 assert.equal(r.items.find(y=>y.key==='handoff-ids').ok,false);assert.equal(x.calls.folders,0);
});
test('auto-import being ON is reported as unsafe for preflight',()=>{
 const x=setup({triggerOn:true});const r=x.call();
 assert.equal(r.items.find(y=>y.key==='legacy-switches-off').ok,false);
});
test('diagnosis does not expose secret configuration values',()=>{
 const x=setup();const raw=JSON.stringify(x.call());
 assert.ok(!raw.includes('SECRET'));assert.ok(!raw.includes('root-012345'));assert.ok(!raw.includes('test-model'));
});

test('starting at an already existing response row is unsafe',()=>{
 const x=setup({responseLastRow:120});const r=x.call();
 assert.equal(r.items.find(y=>y.key==='new-rows-only').ok,false);
 assert.equal(r.readyForReview,false);
});
test('start after current final response row remains safe for historical reports',()=>{
 const x=setup({responseLastRow:99});const r=x.call();
 assert.equal(r.items.find(y=>y.key==='new-rows-only').ok,true);
});

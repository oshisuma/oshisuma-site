import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./legacy-import-bridge.gs',import.meta.url),'utf8');
const reports=[
 {key:'old',row:8,photos:2,imported:'R-20261117-a1b2c3d4'},
 {key:'new1',row:15,photos:2,imported:''},
 {key:'new2',row:16,photos:1,imported:''},
 {key:'new3',row:17,photos:3,imported:''}
];
function mock({enabled=false,halted=false,owner=true,start=15,max='2',failure=false,list=reports}={}){
 const props=new Map(Object.entries({
   OSH_LEGACY_AUTO_IMPORT_ENABLED:String(enabled),
   OSH_LEGACY_AUTO_HALTED:String(halted),
   OSH_LEGACY_AUTO_START_ROW:String(start),
   OSH_LEGACY_AUTO_MAX_PER_TICK:String(max)
 }));
 const imported=[];
 const context=vm.createContext({
  PropertiesService:{getScriptProperties:()=>({
   getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v)
  })},
  CONFIG:{MODE:'production',MAX_PHOTOS:5,RECENT_RESPONSES:15},
  Logger:{log:()=>{}},
  requireApprover_:()=>{
   if(!owner)throw Error('権限がありません');
   return 'owner@example.test';
  },
  apiResponses:()=>list,
  apiImport:key=>{
   if(failure)throw Error('failed after partial Drive copy');
   imported.push(key);
   return {reportId:'R-20261118-'+(key==='new1'?'aaaaaaaa':key==='new2'?'bbbbbbbb':'cccccccc')};
  }
 });
 vm.runInContext(code,context,{filename:'legacy-import-bridge.gs',timeout:1000});
 return {run:()=>vm.runInContext('oshLegacyAutoImportTick()',context,{timeout:1000}),props,imported};
}
test('default OFF: does not touch intake',()=>{
 const a=mock();assert.equal(a.run().status,'disabled');assert.deepEqual(a.imported,[]);
});
test('only newly submitted, not-yet-imported rows are selected',()=>{
 const a=mock({enabled:true});const x=a.run();
 assert.deepEqual(a.imported,['new1','new2']);assert.equal(x.imported,2);
});
test('each execution is capped at 3 imports',()=>{
 const a=mock({enabled:true,max:'3'});a.run();
 assert.deepEqual(a.imported,['new1','new2','new3']);
});
test('past reports remain untouched by start row cutoff',()=>{
 const a=mock({enabled:true,start:17});a.run();
 assert.deepEqual(a.imported,['new3']);
});
test('no auto import if owner session is not confirmed',()=>{
 const a=mock({enabled:true,owner:false});
 assert.throws(()=>a.run(),/権限/);assert.equal(a.imported.length,0);
});
test('a partially failed old import halts future automatic retries',()=>{
 const a=mock({enabled:true,failure:true});
 assert.throws(()=>a.run(),/自動取込を停止/);
 assert.equal(a.props.get('OSH_LEGACY_AUTO_HALTED'),'true');
 assert.throws(()=>a.run(),/前回の取込エラー/);
});
test('already halted system never touches reports',()=>{
 const a=mock({enabled:true,halted:true});
 assert.throws(()=>a.run(),/停止/);assert.equal(a.imported.length,0);
});
test('invalid import limits are rejected',()=>{
 for(const max of ['0','4','abc']){
  const a=mock({enabled:true,max});
  assert.throws(()=>a.run(),/最大取り込み件数/);
 }
});
test('missing or incorrect start row is rejected',()=>{
 for(const start of ['1','NaN']){
  const a=mock({enabled:true,start});
  assert.throws(()=>a.run(),/開始する回答行/);
 }
});
test('photos outside 1..5 are not imported',()=>{
 const a=mock({enabled:true,list:[{key:'zero',row:18,photos:0,imported:''},{key:'six',row:19,photos:6,imported:''}]});
 a.run();assert.equal(a.imported.length,0);
});
test('new rows are handled oldest-first for predictable backlogs',()=>{
 const a=mock({enabled:true,list:[...reports].reverse()});a.run();
 assert.deepEqual(a.imported,['new1','new2']);
});

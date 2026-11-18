import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./legacy-import-bridge.gs',import.meta.url),'utf8');
function harness({enabled=false,authorized=true,start=10,cursor=null,last=13,max=2,
 missingDateRow=null,badPhotosRow=null,failAt=null,duplicates=[],persisted=true}={}){
 const prop=new Map(Object.entries({
 OSH_LEGACY_AUTO_IMPORT_ENABLED:String(enabled),
 OSH_LEGACY_AUTO_START_ROW:String(start),
 OSH_LEGACY_AUTO_MAX_PER_TICK:String(max)
 }));
 if(cursor!==null)prop.set('OSH_LEGACY_IMPORT_CURSOR',String(cursor));
 const calls={readRows:[],api:[],auth:0};
 const rows=Array.from({length:last+1},(_,i)=>i);
 const ledger={}; for(const x of duplicates)ledger['sent_'+x]='R-20261118-abc12345';
 const ctx=vm.createContext({
  CONFIG:{MODE:'production',RESPONSE_SPREADSHEET_ID:'fake-form',KEY_PREFIX:'sent_',MAX_PHOTOS:5},
  PropertiesService:{getScriptProperties:()=>({
    getProperty:k=>prop.get(k)??null,
    setProperty:(k,v)=>prop.set(k,v)
  })},
  requireApprover_:()=>{calls.auth++;if(!authorized)throw Error('許可されていません');return 'owner'},
  responseSheet_:()=>({getLastRow:()=>last}),
  getLayout_:()=>({}),
  readReport_:(sheet,row)=>{
    calls.readRows.push(row);
    return {timestampKey:row===missingDateRow?'':'2026-11-18T04:00:00Z',photoIds:
      row===badPhotosRow?[]:['fake-photo-'+row]};
  },
  reportKey_:(sid,report)=>'sent_'+calls.readRows.at(-1),
  importedKeys_:()=>({...ledger}),
  apiImport:key=>{
    calls.api.push(key);
    if(key==='sent_'+failAt)throw Error('photo copy incomplete');
    return {reportId:'R-20261118-1234abcd'};
  },
  Logger:{log:()=>{}}
 });
 vm.runInContext(code,ctx,{timeout:1000});
 return {run:()=>vm.runInContext('oshLegacyAutoImportTick()',ctx,{timeout:1000}),prop,calls,ctx};
}
test('default OFF never accesses responses',()=>{
 const x=harness();assert.equal(x.run().status,'disabled');assert.deepEqual(x.calls.readRows,[]);
});
test('new rows processed oldest-first and cursor advanced',()=>{
 const x=harness({enabled:true,start:10,last:13,max:2});
 const a=x.run();assert.deepEqual(x.calls.api,['sent_10','sent_11']);assert.equal(a.status,'more');
 assert.equal(x.prop.get('OSH_LEGACY_IMPORT_CURSOR'),'12');
 x.run();assert.deepEqual(x.calls.api,['sent_10','sent_11','sent_12','sent_13']);
 assert.equal(x.prop.get('OSH_LEGACY_IMPORT_CURSOR'),'14');
});
test('a large backlog beyond old 15-response window is not missed',()=>{
 const x=harness({enabled:true,start:10,last:31,max:3});
 for(let i=0;i<8;i++)x.run();
 assert.equal(x.calls.api.length,22);assert.equal(x.calls.api.at(-1),'sent_31');
});
test('already imported report is skipped but cursor advances',()=>{
 const x=harness({enabled:true,start:10,last:11,duplicates:[10]});x.run();
 assert.deepEqual(x.calls.api,['sent_11']);assert.equal(x.prop.get('OSH_LEGACY_IMPORT_CURSOR'),'12');
});
test('one photo is accepted, zero photos stops safely',()=>{
 const x=harness({enabled:true,start:10,last:11,badPhotosRow:11});
 assert.throws(()=>x.run(),/自動取込を停止/);
 assert.deepEqual(x.calls.api,['sent_10']);
 assert.equal(x.prop.get('OSH_LEGACY_IMPORT_CURSOR'),'11');
 assert.equal(x.prop.get('OSH_LEGACY_AUTO_HALTED'),'true');
});
test('failed apiImport never advances cursor and stops retries',()=>{
 const x=harness({enabled:true,failAt:10});
 assert.throws(()=>x.run(),/停止/);assert.equal(x.prop.get('OSH_LEGACY_IMPORT_CURSOR'),undefined);
 assert.throws(()=>x.run(),/前回の取込エラー/);
 assert.equal(x.calls.api.length,1);
});
test('old rows are never read, unauthorized owner is rejected',()=>{
 const x=harness({enabled:true,authorized:false,start:10,last:12});
 assert.throws(()=>x.run(),/許可/);assert.deepEqual(x.calls.readRows,[]);
});
test('cursor before start is refused without touching any report',()=>{
 const x=harness({enabled:true,start:10,cursor:9});
 assert.throws(()=>x.run(),/カーソル/);assert.deepEqual(x.calls.readRows,[]);
});
test('shrunk sheet row count is treated as inconsistency',()=>{
 const x=harness({enabled:true,start:10,cursor:15,last:11});
 assert.throws(()=>x.run(),/行数/);
});
test('invalid maximum batch size fails closed',()=>{
 for(const max of [0,4,'xxx']){
  const x=harness({enabled:true,max});assert.throws(()=>x.run(),/件数/);
 }
});
test('date missing in a new row halts, rather than skipping potentially incomplete entry',()=>{
 const x=harness({enabled:true,missingDateRow:10});
 assert.throws(()=>x.run(),/停止/);
 assert.equal(x.prop.get('OSH_LEGACY_AUTO_HALTED'),'true');
});

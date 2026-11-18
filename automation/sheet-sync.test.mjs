import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./sheet-sync.gs',import.meta.url),'utf8');
const id='R-20261118-abcd1234';
const head=['報告ID','版','HP','Google','報告データ（JSON）','更新日時'];
const draft=(stage='needs-photo-review')=>({
 reportId:id,source:{mode:'production'},status:'draft',workflow:{stage},
 facts:{area:{name:'水戸市'},device:{name:'iPhone 13'}},
 media:[{privacyCheck:'pending',contentMatch:'pending'}],
 approval:{hp:{state:'draft'},gbp:{state:'draft'}},
 publishLog:{hp:null,gbp:null},
 drafts:{hp:stage==='hold'?null:{slug:'demo'},gbp:stage==='hold'?null:{summary:'demo'}}
});
const iterator=a=>{let i=0;return {hasNext:()=>i<a.length,next:()=>a[i++]};};
function harness({enabled=false,initial=[],data=draft(),headers=head}={}){
 const rows=initial.map(r=>r.slice());
 const emails=[];
 const settings=new Map(Object.entries({
  AUTO_DRAFT_SHEET_SYNC_ENABLED:String(enabled),
  HANDOFF_FOLDER_ID:'root',MANAGEMENT_SPREADSHEET_ID:'mgmt',
  AUTO_START_AFTER:'2026-11-17T00:00:00Z',
  OWNER_EMAIL:'owner@example.test',APPROVAL_URL:'https://example.test/approve'
 }));
 const files=[{
  getName:()=>id+'.json',getDateCreated:()=>new Date('2026-11-18T02:00:00Z'),
  getBlob:()=>({getDataAsString:()=>JSON.stringify(data)})
 }];
 const sheet={
  getLastRow:()=>rows.length+1,
  getRange:(r,col,n,w)=>({getValues:()=>r===1?[headers]:rows.map(x=>w===1?[x[0]]:x)}),
  appendRow:r=>rows.push(r)
 };
 const ctx=vm.createContext({
  Date,Set,JSON,
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>settings.get(k)||null,setProperty:(k,v)=>settings.set(k,v)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  SpreadsheetApp:{openById:()=>({getSheetByName:()=>sheet})},
  MailApp:{sendEmail:(...a)=>emails.push(a)},
  DriveApp:{getFolderById:()=>({getFoldersByName:()=>iterator([{getFiles:()=>iterator(files)}])})}
 });
 vm.runInContext(source,ctx);
 return {rows,settings,emails,run:()=>vm.runInContext('oshAutoDraftSheetSyncTick()',ctx)};
}
test('default OFF does not write',()=>{const x=harness();x.run();assert.equal(x.rows.length,0);});
test('new draft is imported once and stays unapproved',()=>{
 const x=harness({enabled:true});x.run();x.run();assert.equal(x.rows.length,1);
 assert.deepEqual(Array.from(x.rows[0].slice(0,4)),[id,1,'draft','draft']);
 assert.equal(x.emails.length,1);
});
test('existing ID is never overwritten',()=>{
 const existing=[id,3,'approved','approved','{"custom":"keep"}','timestamp'];
 const x=harness({enabled:true,initial:[existing]});x.run();
 assert.deepEqual(x.rows[0],existing);assert.equal(x.rows.length,1);
});
test('incomplete repair stays on hold and is not approved',()=>{
 const x=harness({enabled:true,data:draft('hold')});x.run();
 assert.equal(JSON.parse(x.rows[0][4]).workflow.stage,'hold');
 assert.equal(x.rows[0][2],'draft');
});
test('already approved report is rejected',()=>{
 const data=draft();data.approval.hp.state='approved';
 const x=harness({enabled:true,data});
 assert.throws(()=>x.run(),/未承認の安全な下書き/);assert.equal(x.rows.length,0);
});
test('unreviewed photo field cannot be marked safe by AI',()=>{
 const data=draft();data.media[0].privacyCheck='ok';
 const x=harness({enabled:true,data});assert.throws(()=>x.run(),/写真が未確認/);
 assert.equal(x.rows.length,0);
});
test('schema drift stops before write',()=>{
 const x=harness({enabled:true,headers:['BAD',...head.slice(1)]});
 assert.throws(()=>x.run(),/列名が変更/);assert.equal(x.rows.length,0);
});

test('already approved sheet row is never re-notified',()=>{
 const d=draft(),old=[id,2,'approved','approved',JSON.stringify(d),'time'];
 const x=harness({enabled:true,initial:[old]});x.run();assert.equal(x.emails.length,0);
});

test('after a failed email, an existing unapproved draft can be notified on retry',()=>{
 const d=draft(), existing=[id,1,'draft','draft',JSON.stringify(d),'time'];
 const x=harness({enabled:true,initial:[existing]});
 x.run();x.run();
 assert.equal(x.rows.length,1);
 assert.equal(x.emails.length,1);
 assert.match(x.emails[0][1],/下書きを保存/);
});
test('an explicitly held report is never notified',()=>{
 const d=draft(), existing=[id,1,'draft','draft',JSON.stringify(d),'time'];
 const x=harness({enabled:true,initial:[existing]});
 x.settings.set('HOLD_REPORT_IDS',id);
 x.run();
 assert.equal(x.emails.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./owner-preview.gs',import.meta.url),'utf8');
const id='R-20261118-a1b2c3d4';
const headers=['報告ID','版','HP','Google','報告データ（JSON）','更新日時'];
const report=()=>({
 reportId:id,status:'draft',workflow:{stage:'needs-photo-review'},
 source:{mode:'production'},
 facts:{device:{name:'iPhone 13'},area:{name:'水戸市'}},
 intake:{reportText:'非公開のスタッフメモ'},
 media:[{id:'p1',original:'drive:some-personal-photo',privacyCheck:'pending',contentMatch:'pending',alt:''}],
 drafts:{hp:{titleDevice:'iPhone 13',titleServices:['画面修理'],description:'画面割れを修理',sections:[{heading:'ご相談',paragraphs:['画面が割れた']} ]},gbp:{summary:'iPhone 13の画面修理'}},
 approval:{hp:{state:'draft'},gbp:{state:'draft'}},publishLog:{hp:null,gbp:null}
});
function harness({enabled=true,email='owner@example.test',owner='owner@example.test',data=report(),state='draft',hold='',dupe=false}={}){
 const settings=new Map(Object.entries({
  PREVIEW_OWNER_ENABLED:String(enabled), PREVIEW_OWNER_EMAIL:owner,
  MANAGEMENT_SPREADSHEET_ID:'sheet',HOLD_REPORT_IDS:hold
 }));
 const rows=[[id,1,state,'draft',JSON.stringify(data)]];
 if(dupe)rows.push(rows[0]);
 let sheetsRead=0;
 const sheet={
   getLastRow:()=>rows.length+1,
   getRange:(row,col,n,width)=>({getValues:()=>{
     sheetsRead++;
     return row===1?[headers]:rows.map(r=>r.slice(col-1,col-1+width));
   }})
 };
 const context=vm.createContext({
   JSON,Set,
   Session:{getActiveUser:()=>({getEmail:()=>email})},
   PropertiesService:{getScriptProperties:()=>({getProperty:k=>settings.get(k)??null})},
   SpreadsheetApp:{openById:()=>({getSheetByName:n=>n==='下書き'?sheet:null})}
 });
 vm.runInContext(source,context,{timeout:1000});
 const view=rid=>vm.runInContext('oshPreviewOwnerView('+JSON.stringify(rid)+')',context,{timeout:1000});
 return {view,get sheetsRead(){return sheetsRead},settings};
}
test('owner can read a pending draft with no approval action',()=>{
 const v=harness().view(id);
 assert.equal(v.device,'iPhone 13');
 assert.equal(v.canApprove,false);
 assert.equal(v.photos[0].state,'pending');
 assert.equal(v.hp.sections[0].paragraphs[0],'画面が割れた');
 assert.equal(v.gbp,'iPhone 13の画面修理');
 assert.equal(JSON.stringify(v).includes('some-personal-photo'),false);
 assert.equal(JSON.stringify(v).includes('非公開のスタッフメモ'),false);
});
test('unauthenticated and wrong owner are denied before accessing sheet',()=>{
 for(const email of ['', 'someone@example.test']){
  const x=harness({email});
  assert.throws(()=>x.view(id),/権限/);assert.equal(x.sheetsRead,0);
 }
});
test('default-off equivalent is denied before accessing sheet',()=>{
 const x=harness({enabled:false});
 assert.throws(()=>x.view(id),/無効/);assert.equal(x.sheetsRead,0);
});
test('a held report is labelled hold even if report data is a pending draft',()=>{
 const x=harness({hold:id});const v=x.view(id);
 assert.equal(v.stage,'hold');
});
test('approved rows cannot be used as pending previews',()=>{
 const x=harness({state:'approved'});
 assert.throws(()=>x.view(id),/未承認/);
});
test('approval status in report also blocks preview',()=>{
 const d=report();d.approval.hp.state='approved';
 assert.throws(()=>harness({data:d}).view(id),/未承認/);
});
test('duplicate IDs are rejected rather than selecting arbitrarily',()=>{
 assert.throws(()=>harness({dupe:true}).view(id),/重複/);
});
test('invalid report ID is rejected before sheet lookup',()=>{
 const x=harness();
 assert.throws(()=>x.view('../private'),/報告ID/);
 assert.equal(x.sheetsRead,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./integration-preflight.gs',import.meta.url),'utf8');
const formHeaders=['タイムスタンプ','担当スタッフ','お客様来店地域',
  'その他の地域名（その他を選んだ場合のみ）','機種・サービス名','今日の対応内容','写真'];
const draftHeaders=['報告ID','版','HP','Google','報告データ（JSON）','更新日時'];
const importedHeaders=['報告キー','報告ID','回答の行','報告日時','取り込み日時','担当スタッフ（非公開）'];
function mock({owner='owner@example.test',active='owner@example.test',enabled=false,
 missingHold=false,wrongForm=false,wrongImport=false,missingFolder=false,consent=false}={}) {
 const props=new Map(Object.entries({
  PREVIEW_OWNER_EMAIL:owner, PREVIEW_OWNER_ENABLED:'false',
  AUTO_INTAKE_ENABLED:String(enabled),AUTO_DRAFT_ENABLED:'false',
  AUTO_DRAFT_SHEET_SYNC_ENABLED:'false',
  HANDOFF_FOLDER_ID:'folder',SOURCE_SPREADSHEET_ID:'form',MANAGEMENT_SPREADSHEET_ID:'management',
  AUTO_START_AFTER:'2026-11-18T00:00:00Z',AUTO_INTAKE_MIN_ROW:'100',
  HOLD_REPORT_IDS:missingHold?'R-20261117-f5586927':
    'R-20261117-f5586927,R-20261117-83fc7631',
  AI_DATA_SHARING_APPROVED:String(consent),
  ANTHROPIC_API_KEY:'test-secret',ANTHROPIC_MODEL:'test-model',
  OWNER_EMAIL:'owner@example.test',APPROVAL_URL:'https://example.test/approval'
 }));
 const stats={reads:0,writes:0};
 const getSheet=(name)=>{
  let h=name==='フォームの回答 1'?(wrongForm?['WRONG']:formHeaders):
    name==='下書き'?draftHeaders:(wrongImport?['WRONG']:importedHeaders);
  return {getRange:()=>({getValues:()=>{stats.reads++;return [h];}})};
 };
 const ctx=vm.createContext({
  Date,Set,
  Session:{getActiveUser:()=>({getEmail:()=>active})},
  PropertiesService:{getScriptProperties:()=>({
    getProperty:k=>props.get(k)??null,
    setProperty:()=>{stats.writes++;}
  })},
  SpreadsheetApp:{openById:id=>({getSheetByName:name=>getSheet(name)})},
  DriveApp:{getFolderById:()=>({
    getFoldersByName:name=>({hasNext:()=>!missingFolder||name!=='photos'})
  })},
  Utilities:{formatDate:()=> '2026-11-18 12:30'}
 });
 vm.runInContext(source,ctx,{timeout:1000});
 const run=()=>vm.runInContext('oshAutoPreflight()',ctx,{timeout:1000});
 return {run,stats,props};
}
test('fully configured dry-run validates without writing or publishing',()=>{
 const a=mock(),r=a.run();
 assert.equal(r.mode,'read-only');
 assert.equal(r.readyToReview,true);
 assert.equal(r.productionAuthorized,false);
 assert.equal(r.results.every(v=>v.ok),true);
 assert.equal(a.stats.writes,0);
});
test('unauthorized visitor is blocked before reading spreadsheets',()=>{
 const a=mock({active:'stranger@example.test'});
 assert.throws(()=>a.run(),/本人確認/);
 assert.equal(a.stats.reads,0);
});
test('blank active user fails closed',()=>{
 const a=mock({active:''});
 assert.throws(()=>a.run(),/本人確認/);
});
test('enabled pipeline is treated as unsafe before integration',()=>{
 const r=mock({enabled:true}).run();
 assert.equal(r.readyToReview,false);
 assert.equal(r.results.find(v=>v.key==='test-mode').ok,false);
});
test('existing held test cases must be configured for exclusion',()=>{
 const r=mock({missingHold:true}).run();
 assert.equal(r.results.find(v=>v.key==='hold-reports').ok,false);
});
test('changes to form columns must prevent integration',()=>{
 const r=mock({wrongForm:true}).run();
 assert.equal(r.results.find(v=>v.key==='form-headers').ok,false);
});
test('changes to imported columns must prevent integration',()=>{
 const r=mock({wrongImport:true}).run();
 assert.equal(r.results.find(v=>v.key==='import-headers').ok,false);
});
test('missing photos folder must prevent integration',()=>{
 const r=mock({missingFolder:true}).run();
 assert.equal(r.results.find(v=>v.key==='folder-photos').ok,false);
});
test('AI sharing approval is not presumed',()=>{
 const r=mock({consent:true}).run();
 assert.equal(r.results.find(v=>v.key==='ai-consent').ok,false);
});
test('no credentials, owner email or Drive IDs are exposed in result',()=>{
 const r=JSON.stringify(mock().run());
 assert.doesNotMatch(r,/test-secret|owner@example\.test|example\.test\/approval|MANAGEMENT_SPREADSHEET_ID/);
});

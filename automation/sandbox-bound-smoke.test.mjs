import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./sandbox-bound-smoke.gs',import.meta.url),'utf8');
const title='オシスマ_修理事例自動化_合成テスト専用_20261118';
const headers={
 'フォームの回答 1':['タイムスタンプ','担当スタッフ','お客様来店地域','その他の地域名（その他を選んだ場合のみ）','機種・サービス名','今日の対応内容','写真'],
 '下書き':['報告ID','版','HP','Google','報告データ（JSON）','更新日時'],
 '取り込み済み':['報告キー','報告ID','回答の行','報告日時','取り込み日時','担当スタッフ（非公開）'],
 '操作の記録':['日時','操作した人','報告ID','対象','操作','内容']
};
function fixture({name=title,staff='【合成テスト】スタッフ',region='水戸市',photos='',extraRow=false,badHeader=false}={}){
 let reads=0,writes=0;
 const sheets={};
 for(const [key,columns] of Object.entries(headers)){
   const values=columns.slice();
   if(badHeader&&key==='下書き')values[0]='誤った列名';
   sheets[key]={
     getRange:(row)=>({getDisplayValues:()=>{
       reads++;
       return [row===1?values:
         ['2026/11/18 17:30:00',staff,region,'','iPhone 15','【合成テスト専用】画面を交換して動作確認した架空の報告',photos]];
     }}),
     getLastRow:()=>key==='フォームの回答 1'?(extraRow?3:2):1
   };
 }
 const ctx=vm.createContext({
   SpreadsheetApp:{getActiveSpreadsheet:()=>({getName:()=>name,getSheetByName:key=>sheets[key]})},
   Logger:{log:()=>{}}
 });
 vm.runInContext(code,ctx,{timeout:1000});
 return {run:()=>ctx.oshSandboxReadOnlySmokeTest(),getReads:()=>reads,getWrites:()=>writes};
}
test('the single synthetic report is accepted read only',()=>{
 const x=fixture(),r=x.run();assert.equal(r.mode,'read-only');
 assert.equal(r.passed.length,5);assert.equal(r.productionChanged,false);
 assert.equal(r.externalCalls,0);assert.equal(x.getWrites(),0);
});
test('does not read a spreadsheet with another title',()=>{
 const x=fixture({name:'オシスマ 本番管理シート'});
 assert.throws(()=>x.run(),/専用シートではありません/);
 assert.equal(x.getReads(),0);
});
test('tampered sheet header stops the check',()=>{
 const x=fixture({badHeader:true});assert.throws(()=>x.run(),/見出し/);
});
test('personal report cannot replace synthetic fixture',()=>{
 const x=fixture({staff:'本物のお客様'});
 assert.throws(()=>x.run(),/テスト以外のデータ/);
});
test('photos remain blank in synthetic fixture',()=>{
 const x=fixture({photos:'drive-id'});
 assert.throws(()=>x.run(),/テスト以外のデータ/);
});
test('unexpected extra records stop the test',()=>{
 const x=fixture({extraRow:true});
 assert.throws(()=>x.run(),/行数/);
});

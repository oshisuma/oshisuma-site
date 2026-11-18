import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('./legacy-draft-payload.gs',import.meta.url),'utf8');
function makeReport(){
 return {
 reportId:'R-20261118-1234abcd',status:'needs-draft',source:{mode:'production'},
 intake:{reportText:'画面が割れたので交換。交換後、動作確認済み。'},
 facts:{area:{name:'水戸市',slug:'mito'},device:{name:'iPhone 15',slug:'iphone15'},uncertain:['写真を確認']},
 media:[{id:'p1',original:'drive:PRIVATE_ID',privacyCheck:'pending',contentMatch:'pending'},
        {id:'p2',original:'drive:PRIVATE_ID_2',privacyCheck:'pending',contentMatch:'pending'}],
 drafts:{hp:null,gbp:null},approval:{hp:{state:'draft'}},publishLog:{hp:null}
 }
}
function makeAi(){
 return {
 ready:true,consultation:'画面割れのご相談',works:['画面交換'],result:'交換後の動作確認ができました',staffComment:'',uncertain:[],
 hp:{titleServices:['画面交換'],description:'水戸市のiPhone 15の画面交換事例',cardSummary:'画面を交換し、動作を確認しました',
 sections:[{heading:'ご相談',paragraphs:['画面が割れたとご相談いただきました']},
 {heading:'修理内容',paragraphs:['画面を交換しました']},
 {heading:'修理後',paragraphs:['交換後の動作を確認しました']}]},
 gbp:{summary:'水戸市からiPhone 15の画面交換についてご相談をいただき、対応しました。'}
 };
}
const context=vm.createContext({});
vm.runInContext(script,context,{timeout:1000});
function create(report,ai){return context.oshLegacyCreateDraftPatch_(report,ai,'2026-11-18');}
test('valid legacy JSON patch has only fields accepted by applyDraft_',()=>{
 const r=makeReport(),before=JSON.stringify(r);
 const p=create(r,makeAi());
 assert.equal(p.reportId,r.reportId);
 assert.equal(p.drafts.hp.titleDevice,'iPhone 15');
 assert.equal(p.drafts.hp.titleArea,'水戸市');
 assert.match(p.drafts.hp.slug,/^2026-11-18-mito-iphone15-repair-1234abcd$/);
 assert.equal(p.drafts.hp.sections.length,3);
 assert.deepEqual(JSON.parse(JSON.stringify(p.media)),[]);
 assert.ok(!('approval'in p)&&!('intake'in p)&&!('publishLog'in p));
 assert.ok(!JSON.stringify(p).includes('PRIVATE_ID'));
 assert.equal(JSON.stringify(r),before);
});
test('incomplete repair or advice-only report must not become a repair article',()=>{
 const a=makeAi();a.ready=false;assert.equal(create(makeReport(),a),null);
});
test('only needs-draft, never already published report',()=>{
 const r=makeReport();r.status='draft';assert.throws(()=>create(r,makeAi()),/下書き作成待ち/);
 const p=makeReport();p.publishLog.hp={at:'2026-11-18'};assert.throws(()=>create(p,makeAi()),/下書き作成待ち/);
});
test('title service cannot invent work not in verified works',()=>{
 const a=makeAi();a.hp.titleServices=['バッテリー交換'];
 assert.throws(()=>create(makeReport(),a),/実施した作業/);
});
test('without confirmed area or device slug do not generate',()=>{
 const r=makeReport();r.facts.area=null;
 assert.throws(()=>create(r,makeAi()),/地域または機種/);
});
test('invalid or excessive images do not generate',()=>{
 const r=makeReport();r.media=[];
 assert.throws(()=>create(r,makeAi()),/元写真/);
});
test('never invent image descriptions or bypass pending image approval',()=>{
 const p=create(makeReport(),makeAi());
 assert.deepEqual(JSON.parse(JSON.stringify(p.media)),[]);
 assert.equal(p.drafts.hp.featureMedia,'p1');
 assert.equal(p.drafts.hp.cardMedia,'p2');
});
test('unknown or empty result is rejected',()=>{
 const a=makeAi();a.result='';
 assert.throws(()=>create(makeReport(),a),/修理内容・結果/);
});
test('unsafe URL in GBP is rejected',()=>{
 const a=makeAi();a.gbp.summary='https://example.com';
 assert.throws(()=>create(makeReport(),a),/Google投稿本文/);
});

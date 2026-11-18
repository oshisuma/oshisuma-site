import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./legacy-photo-alt.gs',import.meta.url),'utf8');
function fixture({photoOk=true,approved=false,published=false,revision=2}={}){
 const photo={id:'p1',alt:'',privacyCheck:photoOk?'ok':'pending',contentMatch:photoOk?'ok':'pending'};
 const actions=[], report={reportId:'R-20261118-1234abcd',media:[photo],
  drafts:{hp:{featureMedia:'p1'},gbp:{media:'p1'}},
  approval:{hp:{state:published?'published':approved?'approved':'draft'},
            gbp:{state:approved?'approved':'draft'},
            gbpPhotos:{state:approved?'approved':'draft'}}};
 const d={report,revision}, context=vm.createContext({
   withDraft_:(id,rev,fn)=>{
    if(rev!==d.revision)throw Error('版が違います');
    fn(d,'owner@example.test');return d;
   },
   approvalOf_:(r,ch)=>r.approval[ch]||{state:'draft'},
   now_:()=> '2026-11-18T12:00:00.000Z',
   log_:(...args)=>actions.push(args)
 });
 vm.runInContext(code,context,{timeout:1000});
 return {run:(value='水戸市からお越しのお客様のiPhone 15の修理写真',rev=d.revision)=>
   context.oshLegacySetPhotoAlt(report.reportId,'p1',value,rev),report,d,actions};
}
test('approved photo may be given a descriptive alt by verified owner route',()=>{
 const x=fixture();x.run();assert.equal(x.d.revision,3);assert.ok(x.report.media[0].alt.includes('iPhone 15'));assert.equal(x.actions.length,1);
});
test('pending photos are never made publishable merely by entering alt',()=>{
 const x=fixture({photoOk:false});
 assert.throws(()=>x.run(),/目視確認/);assert.equal(x.report.media[0].alt,'');
});
test('published HP prevents changing alt',()=>{
 const x=fixture({published:true});
 assert.throws(()=>x.run(),/公開済み/);assert.equal(x.report.media[0].alt,'');
});
test('an alt change invalidates all existing channel approvals',()=>{
 const x=fixture({approved:true});x.run();
 assert.equal(x.report.approval.hp.state,'draft');
 assert.equal(x.report.approval.gbp.state,'draft');
 assert.equal(x.report.approval.gbpPhotos.state,'draft');
});
test('unchanged text does not change revision or logs',()=>{
 const x=fixture();x.run();x.run(x.report.media[0].alt);
 assert.equal(x.d.revision,3);assert.equal(x.actions.length,1);
});
test('stale revision is denied',()=>{
 const x=fixture();assert.throws(()=>x.run('水戸市のiPhone修理の写真',1),/版/);
});
test('private contact or address details are rejected',()=>{
 const x=fixture();
 for(const value of ['写真に090-1234-5678','〒310-0000 の端末','https://example.com の修理','contact@example.com の端末']){
  assert.throws(()=>x.run(value),/個人情報/);
 }
});
test('too short alt is denied',()=>{
 const x=fixture();assert.throws(()=>x.run('修理'),/8〜180/);
});
test('invalid report id is denied',()=>{
 const x=fixture(); assert.throws(()=>vm.runInNewContext(code+'\noshLegacySetPhotoAlt("invalid","p1","正しく確認した修理写真",2)',{withDraft_:()=>{throw Error('must not call');}}),/報告ID/);
});

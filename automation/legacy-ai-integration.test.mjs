import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const modules=['legacy-ai-runtime.gs','legacy-draft-payload.gs','legacy-auto-draft-bridge.gs']
  .map(name=>readFileSync(new URL('./'+name,import.meta.url),'utf8'));
const ID='R-20261118-abcdef12';
const report=()=>({
 schemaVersion:1,reportId:ID,status:'needs-draft',
 source:{mode:'production',key:'sent_synthetic'},
 intake:{reportText:'iPhone 15の画面割れで来店され、画面交換して動作確認を行いました。'},
 facts:{area:{name:'水戸市',slug:'mito'},device:{name:'iPhone 15',slug:'iphone15'},
 works:[],uncertain:[]},
 media:[{id:'p1',privacyCheck:'pending',contentMatch:'pending',original:'drive:FAKE'},
  {id:'p2',privacyCheck:'pending',contentMatch:'pending',original:'drive:FAKE2'}],
 approval:{hp:{state:'draft'},gbp:{state:'draft'},returns:[]},
 drafts:{hp:null,gbp:null},publishLog:{hp:null,gbp:null}
});
const ai=()=>({
 ready:true,consultation:'画面割れのご相談',
 works:['画面交換'],result:'交換後に動作確認済み',staffComment:'',uncertain:[],
 hp:{titleServices:['画面交換'],description:'水戸市からご来店いただいたiPhone 15の画面修理事例。',
 cardSummary:'画面交換と動作確認を実施しました。',sections:[
 {heading:'ご相談',paragraphs:['画面が割れたとのご相談をいただきました。']},
 {heading:'修理内容',paragraphs:['画面を交換しました。']},
 {heading:'修理後',paragraphs:['交換後に動作確認を行いました。']}
 ]},gbp:{summary:'水戸市からのiPhone 15画面修理事例。画面を交換し動作確認を行いました。'}
});
function fixture({consent=false,enabled=false,respond=ai(),alreadyDraft=false,privateNote=false}={}){
 const props=new Map(Object.entries({
 OSH_LEGACY_AUTO_DRAFT_ENABLED:String(enabled),
 AI_DATA_SHARING_APPROVED:String(consent),
 OSH_LEGACY_AI_START_AFTER:'2026-11-18T00:00:00Z',
 ANTHROPIC_API_KEY:'fake-local-key',ANTHROPIC_MODEL:'fake-model',
 MAX_AI_CALLS_PER_DAY:'2',
 EXCHANGE_IDS:JSON.stringify({intake:'folder-intake',drafts:'folder-drafts'})
 }));
 const r=report();
 if(privateNote)r.intake.reportText+='　お客様の住所は茨城町一丁目にあります。';
 const calls={external:0,saved:[],logs:[]};
 const ctx=vm.createContext({
 PropertiesService:{getScriptProperties:()=>({
 getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v)
 })},
 CONFIG:{MODE:'production'},
 requireApprover_:()=> 'synthetic-owner',
 readDrafts_:()=>[{report:r}],
 readDraftFiles_:()=>alreadyDraft?[{data:{reportId:ID}}]:[],
 Drive:{Files:{list:()=>({files:[{id:'mock-drive-file',name:ID+'.json',
 createdTime:'2026-11-18T05:00:00Z'}]})}},
 DriveApp:{getFileById:()=>({getBlob:()=>({getDataAsString:()=>JSON.stringify(r)})})},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
 Utilities:{formatDate:(date,tz,pattern)=>pattern==='yyyyMMdd'?'20261118':'2026-11-18'},
 UrlFetchApp:{fetch:(_url,_request)=>{
  calls.external++;
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
    content:[{type:'text',text:JSON.stringify(respond)}]
  })};
 }},
 applyDraft_:(r,patch)=>{
  if(patch.drafts.hp.titleArea!==r.facts.area.name ||
     patch.drafts.hp.titleDevice!==r.facts.device.name)return ['invalid title'];
  return [];
 },
 jsonBlob_:(name,obj)=>({name,obj}),
 createFile_:(dir,name,blob)=>calls.saved.push({dir,name,blob}),
 Logger:{log:msg=>calls.logs.push(msg)},Date
 });
 modules.forEach((code,i)=>vm.runInContext(code,ctx,{filename:'legacy-module-'+i,timeout:1000}));
 return {run:()=>vm.runInContext('oshLegacyAutoDraftTick()',ctx,{timeout:1000}),ctx,calls,props};
}
test('disabled legacy pipeline performs zero AI calls and zero writes',()=>{
 const x=fixture();assert.equal(x.run().status,'disabled');assert.equal(x.calls.external,0);
 assert.equal(x.calls.saved.length,0);
});
test('client consent is required before any AI prompt or file creation',()=>{
 const x=fixture({enabled:true});assert.throws(()=>x.run(),/許可/);
 assert.equal(x.calls.external,0);
});
test('AI draft flows through real runtime, real payload builder and legacy bridge',()=>{
 const x=fixture({enabled:true,consent:true});const result=x.run();
 assert.equal(result.generated,1);assert.equal(x.calls.external,1);
 assert.equal(x.calls.saved.length,1);
 const saved=x.calls.saved[0].blob.obj;
 assert.equal(saved.reportId,ID);
 assert.equal(saved.drafts.hp.titleArea,'水戸市');
 assert.equal(saved.drafts.hp.featureMedia,'p1');
 assert.equal(saved.media.length,0,'AI must not approve or describe unreviewed photos');
 assert.ok(!JSON.stringify(saved).includes('drive:FAKE'));
 assert.ok(!('approval' in saved));
});
test('draft file already exists means no API charge or rewrite',()=>{
 const x=fixture({enabled:true,consent:true,alreadyDraft:true});assert.equal(x.run().generated,0);
 assert.equal(x.calls.external,0);
});
test('sensitive report never reaches AI even when toggles are ON',()=>{
 const x=fixture({enabled:true,consent:true,privateNote:true});
 assert.equal(x.run().generated,0);assert.equal(x.calls.external,0);
 assert.equal(x.calls.saved.length,0);
});
test('unfinished repair goes to hold; no article or photos emitted',()=>{
 const x=fixture({enabled:true,consent:true,respond:{...ai(),ready:false}});
 assert.equal(x.run().generated,0);assert.equal(x.calls.saved.length,0);
 assert.equal(x.props.get('OSH_LEGACY_AI_HOLD_'+ID),'true');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./legacy-ai-runtime.gs',import.meta.url),'utf8');
const sample=()=>({intake:{reportText:'iPhone 15の画面が割れ、画面交換して動作確認まで完了しました。'},
 facts:{area:{name:'水戸市'},device:{name:'iPhone 15'}}});
const ai={ready:true,consultation:'画面割れ',works:['画面交換'],result:'動作確認済み',
 staffComment:'',uncertain:[],hp:{titleServices:['画面交換'],description:'水戸市の画面交換',
 cardSummary:'交換し動作を確認',sections:[
 {heading:'ご相談',paragraphs:['画面割れのご相談']},
 {heading:'修理内容',paragraphs:['画面を交換しました']},
 {heading:'修理後',paragraphs:['動作確認しました']}
 ]},gbp:{summary:'水戸市でiPhoneの画面交換'}};
function fixture({approved=false,enabled=false,reply=ai}={}){
 const props=new Map(Object.entries({
 OSH_LEGACY_AUTO_DRAFT_ENABLED:String(enabled),
 AI_DATA_SHARING_APPROVED:String(approved),
 MAX_AI_CALLS_PER_DAY:'2'
 }));
 const requests=[];
 const context=vm.createContext({
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)??null,
 setProperty:(k,v)=>props.set(k,v)})},
 Utilities:{formatDate:()=> '20261118'},
 UrlFetchApp:{fetch:(url,options)=>{
  requests.push({url,options});
  return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({content:[{type:'text',text:JSON.stringify(reply)}]})};
 }}
 });
 vm.runInContext(code,context,{timeout:1000});
 return {context,requests,props,report:sample(),
 generate:()=>context.oshLegacyAiGenerate_(sample(),{apiKey:'dummy-test',model:'fake-model'})};
}
test('AI disabled means no external network calls',()=>{
 const x=fixture();assert.throws(()=>x.generate(),/許可/);assert.equal(x.requests.length,0);
});
test('enabled without data sharing approval never contacts API',()=>{
 const x=fixture({enabled:true});assert.throws(()=>x.generate(),/許可/);assert.equal(x.requests.length,0);
});
test('explicitly enabled mock sends report text only; no photos or Drive IDs',()=>{
 const x=fixture({approved:true,enabled:true});const a=x.generate();
 assert.equal(a.ready,true);assert.equal(x.requests.length,1);
 assert.equal(x.requests[0].url,'https://api.anthropic.com/v1/messages');
 assert.equal(x.requests[0].options.headers['anthropic-version'],'2026-10-21');
 assert.equal(x.requests[0].options.headers.Authorization,'Bearer dummy-test');
 const body=x.requests[0].options.payload;
 assert.ok(body.includes('iPhone 15'));assert.ok(!body.includes('drive:'));
});
test('PII in report is sanitized before mock request',()=>{
 const x=fixture({approved:true,enabled:true});
 const r=sample();r.intake.reportText='iPhone 15の画面交換を完了。090-1234-5678 contact@example.com';
 x.context.oshLegacyAiGenerate_(r,{apiKey:'dummy-test',model:'fake'});
 const body=x.requests[0].options.payload;
 assert.ok(!body.includes('090-1234-5678'));assert.ok(!body.includes('contact@example.com'));
});
test('malformed AI response is not accepted as a draft',()=>{
 const x=fixture({approved:true,enabled:true,reply:{ready:'yes',works:[]}});
 assert.throws(()=>x.generate(),/必須項目/);
});
test('daily cap is fail closed and counts attempted API calls',()=>{
 const x=fixture({approved:true,enabled:true});const p={getProperty:k=>x.props.get(k)??null,
 setProperty:(k,v)=>x.props.set(k,v)};
 assert.equal(x.context.oshLegacyAiBudget_(p),true);
 assert.equal(x.context.oshLegacyAiBudget_(p),true);
 assert.equal(x.context.oshLegacyAiBudget_(p),false);
});
test('missing AI settings rejects without network call',()=>{
 const x=fixture({approved:true,enabled:true});
 assert.throws(()=>x.context.oshLegacyAiGenerate_(x.report,{}),/設定/);
 assert.equal(x.requests.length,0);
});

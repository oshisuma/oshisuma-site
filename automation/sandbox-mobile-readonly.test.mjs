import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('./sandbox-mobile-readonly.gs',import.meta.url),'utf8');
function make(options={}){
 const log=[];
 const env={
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>
    key==='OSH_SANDBOX_OWNER_EMAIL'?(options.allowed??'owner@example.test'):''
  })},
  Session:{getActiveUser:()=>({getEmail:()=>options.signedIn??'owner@example.test'})},
  oshSandboxReviewReadContext_:()=>{if(options.reject)throw Error('Invalid');return {ok:true}},
  oshSandboxReviewRead:()=>({reportId:'R-20261118-demo0001',revision:2,
    title:'水戸市のiPhone 15画面修理',description:'架空の報告',
    review:{state:'confirmed'},sections:[{heading:'修理内容',paragraphs:['画面交換']}],
    canPublish:false}),
  HtmlService:{createHtmlOutput(html){
    log.push(html);
    return {html,setTitle(){return this}};
  }},
  String,Error,Object,JSON
 };
 const ctx=vm.createContext(env);
 vm.runInContext(script,ctx,{timeout:1000});
 return {ctx,log};
}
test('mobile synthetic preview code parses',()=>assert.doesNotThrow(()=>new vm.Script(script)));
test('read is owner-only and read-only',()=>{
 const e=make(),v=e.ctx.oshSandboxMobileRead();
 assert.equal(v.canPublish,false);
});
test('an empty active user email is rejected',()=>{
 const e=make({signedIn:''});
 assert.throws(()=>e.ctx.oshSandboxMobileRead());
 const page=e.ctx.doGet();
 assert.match(page.html,/アクセスできません/);
 assert.doesNotMatch(page.html,/記事を読み込んでいます/);
});
test('no owner setting or different actor are rejected',()=>{
 for(const opt of [{allowed:''},{signedIn:'other@example.test'},{reject:true}]){
  const e=make(opt);
  assert.throws(()=>e.ctx.oshSandboxMobileRead());
  assert.match(e.ctx.doGet().html,/アクセスできません/);
 }
});
test('owner page has escaped, DOM-based text rendering and no action buttons',()=>{
 const e=make(),page=e.ctx.doGet(),html=page.html;
 assert.match(html,/確認状態/);
 assert.match(html,/replaceChildren/);
 assert.doesNotMatch(html,/onclick=/);
 assert.doesNotMatch(html,/oshSandboxReviewSave/);
 const browser=html.match(/<script>([\s\S]+?)<\/script>/)?.[1];
 assert.ok(browser);
 assert.doesNotThrow(()=>new vm.Script(browser));
});
test('no outbound API, share, deployment or form mutation',()=>{
 assert.doesNotMatch(script,/\b(?:UrlFetchApp|DriveApp|GmailApp|MailApp)\b/);
 assert.doesNotMatch(script,/\b(?:appendRow|setValues|setValue)\s*\(/);
 assert.doesNotMatch(script,/oshSandboxReviewSave\s*\(/);
});
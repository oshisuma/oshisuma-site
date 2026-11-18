import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('./legacy-owner-review-ui.js',import.meta.url),'utf8');
const funcs={};
function node(tag,attrs,...children){
 const el={tag,attrs,children,hidden:false,disabled:false,value:'',textContent:'',
    focus(){},scrollIntoView(){}};
 return el;
}
function getContext({ok=true,saveFail=false}={}){
 const panel=node('div',{});panel.hidden=true;
 const messages=[],calls=[],renders=[];
 const current={
   reportId:'R-20261118-1234abcd',revision:2,
   needsDraft:false,title:'【水戸市】iPhone 15の画面修理',
   hp:{date:'2026-11-18',cardSummary:'画面修理の対応',
       sections:[{heading:'ご相談',text:'画面割れのご相談'}]},
   gbp:{summary:'画面交換のご報告'},
   photos:[{id:'p1',url:'data:image/png;base64,YWJj',alt:'修理後の画面',decision:'ok'},
     {id:'p2',url:'https://private.example/secret',alt:'未確認写真',decision:'pending'}]
 };
 const ctx=vm.createContext({
 current,
 el:node,put:(el,...children)=>{el.children=children},
 document:{getElementById:id=>id==='osh-photo-alt-editor'?panel:null},
 toast:(msg,err)=>messages.push({msg,err}),
 call:async(...args)=>{
  calls.push(args);if(saveFail)throw Error('save failed');
  return {updated:true};
 },
 render:x=>renders.push(x)
 });
 vm.runInContext(code,ctx,{timeout:1000});
 return {ctx,panel,calls,renders,messages,current};
}
test('client script parses without a browser runtime',()=>{
 assert.ok(new vm.Script(code,{filename:'legacy-owner-review-ui.js'}));
});
test('content preview shows title, sections, and Google text in review-only panel',()=>{
 const x=getContext();
 const tree=x.ctx.oshReviewPreview_(x.current);
 assert.equal(tree.tag,'section');
 assert.equal(tree.attrs.id,'osh-preview-article');
 const asText=JSON.stringify(tree);
 assert.match(asText,/iPhone 15/);
 assert.match(asText,/Google最新情報/);
 assert.match(asText,/画面割れのご相談/);
});
test('only explicitly approved data-uri photographs are used in preview',()=>{
 const x=getContext();
 const tree=x.ctx.oshReviewPreview_(x.current);
 const output=JSON.stringify(tree);
 assert.match(output,/data:image\/png;base64,YWJj/);
 assert.doesNotMatch(output,/private\.example/);
});
test('preview is unavailable before draft generation',()=>{
 const x=getContext();
 x.current.needsDraft=true;
 assert.equal(x.ctx.oshReviewPreview_(x.current),null);
});
test('pending photo cannot open editor or save',()=>{
 const x=getContext();
 x.ctx.oshEditPhotoAlt_({id:'p2',decision:'pending',alt:''});
 assert.equal(x.panel.hidden,true);
 assert.equal(x.calls.length,0);
});
test('approved photo opens edit panel with existing alt',()=>{
 const x=getContext();
 x.ctx.oshEditPhotoAlt_({id:'p1',decision:'ok',alt:'検査済みの写真'});
 assert.equal(x.panel.hidden,false);
 assert.match(JSON.stringify(x.panel),/検査済みの写真/);
});
test('invalid photo id is not allowed',()=>{
 const x=getContext();
 x.ctx.oshEditPhotoAlt_({id:'../../file',decision:'ok',alt:''});
 assert.equal(x.calls.length,0);
});
test('approved edit sends report id, photo id, and revision to existing backend',async()=>{
 const x=getContext();x.ctx.oshEditPhotoAlt_({id:'p1',decision:'ok',alt:''});
 const button=x.panel.children[3].children[0];
 button.attrs.onclick();
 await Promise.resolve();await Promise.resolve();
 assert.equal(x.calls.length,1);
 assert.deepEqual(x.calls[0],['oshLegacySetPhotoAlt','R-20261118-1234abcd','p1','',2]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./legacy-review-inbox.js',import.meta.url),'utf8');
function fixture({lists=[[]],visible=true}={}){
 const timers=[],calls=[],views=[],ui=[];
 const ctx=vm.createContext({
  setInterval:(fn,delay)=>{timers.push({fn,delay});return 7},
  clearInterval:id=>calls.push(['clear',id]),
  document:{visibilityState:visible?'visible':'hidden'},
  call:async name=>{calls.push(['api',name]);return lists[Math.min(calls.filter(x=>x[0]==='api').length-1,lists.length-1)]},
  el:(tag,attrs,...children)=>({tag,attrs,children}),
  put:(target,...elements)=>{target.children=elements;ui.push(elements)},
  showDetail:id=>views.push(id),
  toast:()=>{}
 });
 vm.runInContext(source,ctx,{timeout:1000});
 return {ctx,calls,timers,ui,views};
}
const a={reportId:'R-20261118-aaaaaaaa',hp:'draft',needsDraft:false,test:false,title:'iPhone 15画面交換'};
const b={reportId:'R-20261118-bbbbbbbb',hp:'draft',needsDraft:false,test:false,title:'iPad画面修理'};
test('only proper active report IDs are accepted',()=>{
 const x=fixture();
 const got=x.ctx.oshLegacyInboxIds_([a,{...a,reportId:'bad'}, {...b,needsDraft:true}, {...b,test:true}]);
 assert.deepEqual([...got],[a.reportId]);
});
test('first load sees existing drafts as baseline, not new alerts',async()=>{
 const x=fixture({lists:[[a]]});
 x.ctx.oshLegacyInboxStart({});
 await Promise.resolve();await Promise.resolve();
 assert.equal(x.ui.length,0);
 x.ctx.oshLegacyInboxStop();
});
test('fresh item after initial load is displayed as review prompt',async()=>{
 const x=fixture({lists:[[a],[a,b]]});x.ctx.oshLegacyInboxStart({});
 await Promise.resolve();await Promise.resolve();
 await x.ctx.oshLegacyInboxCheck_();
 await Promise.resolve();await Promise.resolve();
 assert.equal(x.ui.length,1);
 assert.match(JSON.stringify(x.ui[0]),/iPad画面修理/);
 x.ctx.oshLegacyInboxStop();
});
test('hidden page does not poll GAS',async()=>{
 const x=fixture({visible:false});x.ctx.oshLegacyInboxStart({});
 await Promise.resolve();await Promise.resolve();
 assert.equal(x.calls.filter(c=>c[0]==='api').length,0);
 x.ctx.oshLegacyInboxStop();
});
test('polling stops on navigation',()=>{
 const x=fixture();x.ctx.oshLegacyInboxStart({});
 x.ctx.oshLegacyInboxStop();assert.ok(x.calls.some(c=>c[0]==='clear'));
});

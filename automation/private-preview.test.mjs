import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {previewHtml,writePrivatePreview} from './private-preview.mjs';
const sample=()=>({
 reportId:'R-20261118-a1b2c3d4',status:'draft',
 workflow:{stage:'needs-photo-review'},facts:{device:{name:'iPhone 13'},area:{name:'水戸市'}},
 intake:{reportText:'非公開のスタッフ報告パスワード12345'},
 media:[{id:'p1',privacyCheck:'pending',contentMatch:'pending',alt:'',original:'drive:secret_photo_id'}],
 drafts:{
  hp:{titleDevice:'iPhone 13',titleServices:['充電口修理'],description:'修理のご相談',sections:[
   {heading:'ご相談',paragraphs:['充電しないとのご相談']},
   {heading:'修理内容',paragraphs:['充電口を修理']},
   {heading:'修理後',paragraphs:['充電ができることを確認']}
  ]},
  gbp:{summary:'iPhone 13の充電口修理を行いました。'}
 },approval:{hp:{state:'draft'},gbp:{state:'draft'}}
});
test('public URL or publishing code is not present in private preview',()=>{
 const html=previewHtml(sample());
 assert.match(html,/非公開の確認用プレビュー/);
 assert.match(html,/Content-Security-Policy/);
 assert.match(html,/noindex,nofollow/);
 assert.doesNotMatch(html,/<script|<form|https?:\/\//i);
 assert.doesNotMatch(html,/パスワード12345|secret_photo_id/);
});
test('article, GBP body, and unreviewed photo status are visible',()=>{
 const html=previewHtml(sample());
 assert.match(html,/充電しないとのご相談/);
 assert.match(html,/Google投稿の文章/);
 assert.match(html,/未確認・公開不可/);
 assert.match(html,/承認ボタンなし/);
});
test('customer-supplied HTML, scripts, and entities are escaped',()=>{
 const s=sample();s.drafts.hp.sections[0].paragraphs=['<script>alert("pwn")</script>'];
 s.drafts.gbp.summary='<img src=x onerror=alert(1)>&done';
 const html=previewHtml(s);
 assert.doesNotMatch(html,/<script>|<img src=x/);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/&lt;img src=x/);
 assert.match(html,/&amp;done/);
});
test('incomplete repair explicitly stays on hold',()=>{
 const r=sample();r.workflow.stage='hold';r.drafts.hp=null;r.drafts.gbp=null;
 const html=previewHtml(r);
 assert.match(html,/修理結果が未確認・公開保留/);
 assert.match(html,/HP記事の下書きは未作成/);
});
test('published or approved report cannot be previewed by this tool',()=>{
 for(const status of ['published','approved']) {
  const r=sample();r.status=status;
  assert.throws(()=>previewHtml(r),/公開前/);
 }
});
test('invalid photo ID cannot read arbitrary local files',()=>{
 const r=sample();r.media[0].id='../private';
 assert.throws(()=>previewHtml(r,{photoDir:'/tmp'}),/写真ID/);
});
test('private preview output is created once without overwriting existing file',()=>{
 const dir=mkdtempSync(join(tmpdir(),'osh-preview-test-'));
 try {
  const input=join(dir,'report.json'),out=join(dir,'preview.html');
  writeFileSync(input,JSON.stringify(sample()));
  writePrivatePreview(input,out);
  assert.equal(existsSync(out),true);
  assert.match(readFileSync(out,'utf8'),/非公開/);
  assert.throws(()=>writePrivatePreview(input,out),/EEXIST/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('supported photo is embedded only when explicit local photo folder is given',()=>{
 const dir=mkdtempSync(join(tmpdir(),'osh-photo-test-'));
 try{
  const file=join(dir,'p1.jpg');
  writeFileSync(file,Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(16,1)]));
  assert.doesNotMatch(previewHtml(sample()),/data:image\/jpeg;base64/);
  assert.match(previewHtml(sample(),{photoDir:dir}),/data:image\/jpeg;base64/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

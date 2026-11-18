import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {assembleLegacyReview} from './assemble-legacy-review.mjs';

// Do not commit owner's original approval HTML to GitHub.
// Synthetic fixture retains only the anchors needed to verify safe integration.
const synthetic=`<!DOCTYPE html><html><body><script>
const ALLOWED = <?= allowed ?>;
async function showList() {
  put(app, el('div', { class: 'btns' },
    el('button',{},'refresh')));
  list.forEach((d) => {
    app.append(el('button',{class:'card'},d.title));
  });
}
const LABELS = {};
async function showDetail(id) {
  put(app, el('p', {}, '読み込み中'));
}
function render(v) {
  const photos = el('div',{},v.photos.map((p)=>el('div',{},
    el('button', { class: 'b danger' + (p.decision === 'ng' ? ' on' : ''), 'aria-pressed': String(p.decision === 'ng'), onclick: () => decide(p.id, 'ng') }, '使わない')))));
  put(app, el('section',{},
    el('p',{},'公開OK'), photos),
    el('details', { class: 'meta' },'raw'),
    v.needsDraft ? null
      : [channelSection('hp', v), channelSection('gbp', v), photosSection(v),
         replaceArea(v)]);
}
if (ALLOWED) showList();
</script></body></html>`;
const ui="function oshReviewPreview_() {}\nfunction oshEditPhotoAlt_() {}";
const inbox="function oshLegacyInboxStart() {}\nfunction oshLegacyInboxStop() {}";
test('original HTML retains login and behavior and adds three review components',()=>{
 const o=assembleLegacyReview(synthetic,ui,inbox);
 assert.ok(o.includes('const ALLOWED = <?= allowed ?>;'));
 assert.ok(o.includes('function oshReviewPreview_() {}'));
 assert.ok(o.includes("onclick: () => oshEditPhotoAlt_(p)"));
 assert.ok(o.includes("oshLegacyInboxStart(document.getElementById('osh-new-draft-notice'))"));
 assert.ok(o.includes("oshLegacyInboxStop();"));
 assert.ok(o.includes(": [oshReviewPreview_(v), channelSection('hp', v)"));
 assert.ok(o.includes("id: 'osh-photo-alt-editor'"));
});
test('existing integrations are not installed twice',()=>{
 const o=assembleLegacyReview(synthetic,ui,inbox);
 assert.throws(()=>assembleLegacyReview(o,ui,inbox),/二重追加/);
});
test('missing anchor rejects outdated HTML without partial output',()=>{
 assert.throws(()=>assembleLegacyReview(synthetic.replace("async function showDetail(id) {","async function showDetailNew(id) {"),ui,inbox),/構造が変わっています/);
});
test('unknown HTML template cannot receive the integrations',()=>{
 assert.throws(()=>assembleLegacyReview('<html>invalid</html>',ui,inbox),/形式を確認/);
});
test('missing helper scripts cannot generate approval UI',()=>{
 assert.throws(()=>assembleLegacyReview(synthetic,'',''),/部品が不足/);
});

test('assembled HTML script compiles after Apps Script template substitution',()=>{
 const s=assembleLegacyReview(synthetic,ui,inbox);
 const start=s.indexOf('<script>')+'<script>'.length;
 const end=s.indexOf('</script>',start);
 assert.ok(start>=8 && end>start,'HTML must include the target script');
 assert.doesNotThrow(()=>new vm.Script(s.slice(start,end).replace('<?= allowed ?>','true')));
});

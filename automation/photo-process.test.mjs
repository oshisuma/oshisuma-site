import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../tools/cases/photo-process.js', import.meta.url),'utf8');
const sandbox = { globalThis: {} };
vm.runInNewContext(src,sandbox);
const photo=sandbox.globalThis.OshismaPhoto;
test('no enhancement by default',()=>{
  const tone=photo.safeTone(null);
  assert.equal(tone.brightness,1);
  assert.equal(tone.contrast,1);
  assert.equal(tone.saturation,1);
});
test('light natural enhancement is supported',()=>{
  const t=photo.safeTone({brightness:1.05,contrast:1.04,saturation:1.02});
  assert.equal(t.brightness,1.05);
});
test('strong enhancement is blocked',()=>{
  assert.throws(()=>photo.safeTone({brightness:1.5,contrast:1.2,saturation:2}),/強すぎ/);
});
test('invalid enhancement values are blocked',()=>{
  assert.throws(()=>photo.safeTone({brightness:NaN,contrast:1,saturation:1}),/不正/);
});
test('private QR mask maps from original photo onto resized image',()=>{
  const l={sx:0,sy:0,sw:1000,sh:1000,w:500,h:500};
  const rect=photo.maskRect(1000,1000,null,l,{x:0.1,y:0.2,w:0.2,h:0.1});
  assert.equal(rect.x,50);
  assert.equal(rect.y,100);
  assert.equal(rect.w,100);
  assert.equal(rect.h,50);
});
test('mask outside crop does not appear on output',()=>{
  const l={sx:500,sy:0,sw:500,sh:1000,w:250,h:500};
  assert.equal(photo.maskRect(1000,1000,null,l,{x:0.1,y:0.1,w:0.1,h:0.1}),null);
});
test('partly intersecting privacy mask is clipped within output',()=>{
  const l={sx:500,sy:0,sw:500,sh:1000,w:250,h:500};
  const r=photo.maskRect(1000,1000,null,l,{x:0.4,y:0,w:0.3,h:0.2});
  assert.equal(r.x,0);
  assert.equal(r.w,100);
});
test('missing or invalid mask geometry fails closed',()=>{
  const l={sx:0,sy:0,sw:100,w:100,sh:100,h:100};
  for(const m of [{x:-0.1,y:0,w:0.2,h:0.2},{x:0,y:0,w:0,h:0.1},{x:0.9,y:0.1,w:0.3,h:0.2}])
    assert.throws(()=>photo.maskRect(100,100,null,l,m),/不正/);
});

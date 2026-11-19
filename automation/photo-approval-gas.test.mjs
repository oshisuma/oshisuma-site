import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
import {photoTransformFingerprint,photoTransformData} from '../tools/cases/photo-approval.mjs';
const gs=readFileSync(new URL('./photo-approval.gs',import.meta.url),'utf8');
function gasCode() {
 const context=vm.createContext({
  Utilities:{
   DigestAlgorithm:{SHA_256:'SHA-256'},
   Charset:{UTF_8:'UTF-8'},
   computeDigest:(alg,str)=>[...createHash('sha256').update(str,'utf8').digest()]
  }
 });
 vm.runInContext(gs,context);
 return {fp:r=>vm.runInContext('oshPhotoFingerprint_('+JSON.stringify(r)+')',context),
         check:(r,a)=>vm.runInContext('oshPhotoAssertApproved_('+JSON.stringify(r)+','+JSON.stringify(a)+')',context)};
}
const r=()=>({reportId:'R-20261118-a1b2c3d4',media:[
 {id:'p1',original:'drive:111111111111111',crop:{x:0,y:0,w:0.85,h:1},
  privacyMasks:[{x:0.1,y:0.2,w:0.3,h:0.4}],
  photoTone:{brightness:1.04,contrast:1.01,saturation:0.98}},
 {id:'p2',original:'drive:222222222222222',photoTone:{brightness:1,contrast:1,saturation:1}}
]});
test('GAS and Node generate exactly the same SHA-256 approval fingerprint',()=>{
 const a=r();assert.equal(gasCode().fp(a),photoTransformFingerprint(a));
});
test('GAS and Node remain compatible for the empty-edit case',()=>{
 const a=r();delete a.media[0].crop;delete a.media[0].privacyMasks;
 delete a.media[0].photoTone;delete a.media[1].photoTone;
 assert.equal(gasCode().fp(a),photoTransformFingerprint(a));
});
test('GAS denies changed mask after owner approval',()=>{
 const a=r(), g=gasCode(), original=g.fp(a);
 assert.doesNotThrow(()=>g.check(a,{state:'approved',fp:original}));
 a.media[0].privacyMasks[0].x=0.11;
 assert.throws(()=>g.check(a,{state:'approved',fp:original}),/未承認/);
 assert.notEqual(g.fp(a),original);
});
test('GAS rejects malformed settings in the same way as Node',()=>{
 const a=r();a.media[0].crop.w=1.2;
 assert.throws(()=>gasCode().fp(a),/範囲/);
 assert.throws(()=>photoTransformData(a),/範囲/);
});

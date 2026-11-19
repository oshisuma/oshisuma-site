import test from 'node:test';
import assert from 'node:assert/strict';
import { photoTransformData, hasPhotoEdits, photoTransformFingerprint, assertPhotoTransformApproved } from '../tools/cases/photo-approval.mjs';

const base=()=>({reportId:'R-20261118-abcd1234',media:[
 {id:'p1',original:'drive:example-file-123456789',alt:'端末の写真',privacyCheck:'ok',contentMatch:'ok'}
]});
const approved=r=>({state:'approved',fp:photoTransformFingerprint(r)});
test('未加工写真には追加の加工承認を要求しない',()=>{
 const r=base();assert.equal(hasPhotoEdits(r),false);assert.doesNotThrow(()=>assertPhotoTransformApproved(r,null));
});
test('写真マスクは専用の明示承認なしでは止まる',()=>{
 const r=base();r.media[0].privacyMasks=[{x:0.1,y:0.2,w:0.3,h:0.4}];
 assert.equal(hasPhotoEdits(r),true);
 assert.throws(()=>assertPhotoTransformApproved(r,null),/承認されていません/);
 assert.doesNotThrow(()=>assertPhotoTransformApproved(r,approved(r)));
});
test('補正値・マスク位置・切り抜き変更で承認指紋が変わる',()=>{
 const r=base();r.media[0].photoTone={brightness:1.03,contrast:1.02,saturation:1.01};
 const a=approved(r);
 r.media[0].photoTone.brightness=1.04;
 assert.throws(()=>assertPhotoTransformApproved(r,a),/承認されていません/);
 const b=approved(r);r.media[0].crop={x:0.1,y:0.1,w:0.8,h:0.8};
 assert.throws(()=>assertPhotoTransformApproved(r,b),/承認されていません/);
 const d=approved(r);r.media[0].privacyMasks=[{x:0.2,y:0.2,w:0.1,h:0.1}];
 assert.throws(()=>assertPhotoTransformApproved(r,d),/承認されていません/);
});
test('写真ごとの順番変更でも承認が無効になる',()=>{
 const r=base();r.media.push({id:'p2',original:'drive:other-photo-12345678'});
 r.media[0].crop={x:0,y:0,w:0.8,h:0.8};
 const a=approved(r);r.media.reverse();
 assert.throws(()=>assertPhotoTransformApproved(r,a),/承認されていません/);
});
test('許可されない加工オプションはエラー',()=>{
 const r=base();r.media[0].photoTone={brightness:1,contrast:1,saturation:1,removeDamage:true};
 assert.throws(()=>photoTransformData(r),/未対応/);
});
test('範囲外のマスク・強すぎる補正はエラー',()=>{
 const r=base();r.media[0].privacyMasks=[{x:0.95,y:0.1,w:0.2,h:0.2}];
 assert.throws(()=>photoTransformFingerprint(r),/範囲/);
 r.media[0].privacyMasks=[];r.media[0].photoTone={brightness:1.5,contrast:1,saturation:1};
 assert.throws(()=>photoTransformFingerprint(r),/強すぎ/);
});
test('改ざんした指紋やdraft状態では公開不可',()=>{
 const r=base();r.media[0].crop={x:0,y:0,w:1,h:1};
 assert.throws(()=>assertPhotoTransformApproved(r,{state:'draft',fp:photoTransformFingerprint(r)}),/承認されていません/);
 assert.throws(()=>assertPhotoTransformApproved(r,{state:'approved',fp:'a'.repeat(32)}),/承認されていません/);
});
test('正規化データは原本の識別子を含みつつ公開画像の派生ファイルには依存しない',()=>{
 const r=base();r.media[0].photoTone={brightness:1.01,contrast:1,saturation:1};
 const before=photoTransformFingerprint(r);r.media[0].src='/repair/cases/images/example.jpg';
 r.media[0].webp='/repair/cases/images/example.webp';
 assert.equal(photoTransformFingerprint(r),before);
});

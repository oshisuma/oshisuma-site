import test from 'node:test';
import assert from 'node:assert/strict';
import { browserCandidates, findBrowser, imageMimeFromFilename } from '../tools/cases/browser.mjs';
test('Windows Edge path remains available',()=>{
 assert.ok(browserCandidates('win32',{}).some(p=>p.includes('Microsoft/Edge')));
});
test('Linux Chrome/Chromium can be discovered for CI',()=>{
 assert.ok(browserCandidates('linux',{}).some(p=>p.includes('chromium')));
});
test('macOS Chrome path is available',()=>{
 assert.ok(browserCandidates('darwin',{}).some(p=>p.includes('Google Chrome.app')));
});
test('explicit browser path wins',()=>{
 const c=browserCandidates('linux',{PHOTO_BROWSER_PATH:'/custom/chromium',EDGE_PATH:'/other/edge'});
 assert.equal(c[0],'/custom/chromium');
 assert.equal(c[1],'/other/edge');
});
test('finder uses first existing candidate without spawning',()=>{
 assert.equal(findBrowser('linux',{PHOTO_BROWSER_PATH:'/mock/browser'},p=>p==='/mock/browser'),'/mock/browser');
});
test('browser not installed causes clear error',()=>{
 assert.throws(()=>findBrowser('linux',{},()=>false),/見つかりません/);
});
test('images are interpreted using correct MIME rather than always JPEG',()=>{
 assert.equal(imageMimeFromFilename('p1.JPG'),'image/jpeg');
 assert.equal(imageMimeFromFilename('p2.png'),'image/png');
 assert.equal(imageMimeFromFilename('p3.webp'),'image/webp');
});
test('HEIC without verified decoder must be converted before processing',()=>{
 assert.throws(()=>imageMimeFromFilename('p1.heic'),/HEIC/);
});
test('unknown extension is blocked',()=>{
 assert.throws(()=>imageMimeFromFilename('p1.exe'),/未対応/);
});

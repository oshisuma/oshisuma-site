import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleFromRepository,assembleLegacyGas,LEGACY_GAS_MODULES,EXCLUDED_LEGACY_GAS } from './build-legacy-bundle.mjs';
const parts=()=>LEGACY_GAS_MODULES.map(name=>[name,readFileSync(new URL('./'+name,import.meta.url),'utf8')]);
test('review-only GAS bundle parses with all active modules',()=>{
 const s=assembleFromRepository();
 assert.ok(s.includes('function oshLegacyAutoImportTick()'));
 assert.ok(s.includes('function oshLegacyAiGenerate_('));
 assert.ok(s.includes('function oshLegacyAutoDraftTick()'));
 assert.ok(s.includes('function oshLegacySafeSyncTick()'));
 assert.ok(s.includes('function oshLegacySetPhotoAlt('));
});
test('outdated experimental GAS modules never appear in the bundle',()=>{
 const s=assembleFromRepository();
 assert.equal(s.includes('function oshAutoPipelineTick()'),false);
 assert.equal(s.includes('function oshAutoTick()'),false);
 assert.equal(s.includes('function doGet()'),false);
 for(const n of EXCLUDED_LEGACY_GAS)assert.ok(!LEGACY_GAS_MODULES.includes(n));
});
test('missing or swapped modules are rejected',()=>{
 const p=parts();assert.throws(()=>assembleLegacyGas(p.slice(1)),/数/);
 const q=parts();[q[0],q[1]]=[q[1],q[0]];
 assert.throws(()=>assembleLegacyGas(q),/順序/);
});
test('accidentally redefining existing production GAS functions is blocked',()=>{
 const p=parts();p[0][1]+='\nfunction apiApprove() {}\n';
 assert.throws(()=>assembleLegacyGas(p),/上書き/);
});
test('owner consent gate and disabled defaults remain in assembled code',()=>{
 const s=assembleFromRepository();
 assert.match(s,/AI_DATA_SHARING_APPROVED/);
 assert.match(s,/OSH_LEGACY_AUTO_IMPORT_ENABLED/);
 assert.match(s,/OSH_LEGACY_SYNC_ENABLED/);
});

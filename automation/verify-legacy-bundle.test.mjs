import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyLegacyBundle,MODULES,DISABLED_SWITCHES} from './verify-legacy-bundle.mjs';
test('all deployment GAS modules parse together without top-level name collisions',()=>{
 const result=verifyLegacyBundle();
 assert.equal(result.status,'safe-to-review');
 assert.equal(result.modules,7);
});
test('automatic import, AI generation and sync are all OFF by default',()=>{
 const result=verifyLegacyBundle();
 assert.equal(result.initialOffVerified,3);
 assert.equal(result.writes,0);
 assert.equal(result.apiCalls,0);
 assert.equal(result.productionInstalled,false);
});
test('customer data export cannot be enabled by bundle verifier',()=>{
 const result=verifyLegacyBundle();
 assert.equal(result.switches.AI_DATA_SHARING_APPROVED,'false');
 assert.equal(result.switches.OSH_LEGACY_AUTO_DRAFT_ENABLED,'false');
});
test('only allowlisted tested modules may be bundled',()=>{
 assert.throws(()=>verifyLegacyBundle({modules:['old-test-or-publication.gs']}),/未承認/);
});
test('duplicate GAS module is rejected',()=>{
 assert.throws(()=>verifyLegacyBundle({modules:[MODULES[0],MODULES[0]]}),/不正/);
});
test('required switches include new import, AI, sync and data sharing',()=>{
 for(const name of ['OSH_LEGACY_AUTO_IMPORT_ENABLED','OSH_LEGACY_AUTO_DRAFT_ENABLED',
 'OSH_LEGACY_SYNC_ENABLED','AI_DATA_SHARING_APPROVED'])
 assert.ok(DISABLED_SWITCHES.includes(name));
});

/**
 * スタッフの架空報告 → 現行取込ブリッジ → AI模擬応答 → 下書き差分
 * → 現行同期ブリッジ、までの結合試験。
 *
 * すべてメモリ内モック。外部ネットワーク、実顧客、実Drive、実Sheets、
 * 本番承認、HP公開、Google投稿は一切使用しない。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const code=['legacy-import-bridge.gs','legacy-ai-runtime.gs',
 'legacy-draft-payload.gs','legacy-auto-draft-bridge.gs','legacy-safe-sync.gs']
 .map(name=>readFileSync(new URL('./'+name,import.meta.url),'utf8'));
const REPORT_ID='R-20261119-abcd1234';
const REPORT_KEY='sent_synthetic_10';
const DATE='2026-11-19';
const CREATED='2026-11-19T04:00:00Z';
const UPDATED='2026-11-19T05:00:00Z';
function mockAi(){
 return {ready:true,consultation:'画面が割れたとのご相談',
  works:['画面交換'],result:'交換後のタッチ操作と起動を確認',
  staffComment:'',uncertain:[],
  hp:{titleServices:['画面交換'],description:'水戸市のiPhone 15画面交換事例',
    cardSummary:'画面交換後に動作確認を行いました',
    sections:[
     {heading:'ご相談',paragraphs:['画面割れについてご相談いただきました。']},
     {heading:'修理内容',paragraphs:['画面を交換しました。']},
     {heading:'修理後',paragraphs:['タッチ操作と起動を確認しました。']}
    ]},
  gbp:{summary:'水戸市のiPhone 15画面交換。交換後のタッチ操作と起動を確認しました。'}
 };
}
function syntheticReport(){
 return {reportId:REPORT_ID,status:'needs-draft',
  source:{mode:'production',type:'synthetic-test',key:REPORT_KEY},
  intake:{reportText:'架空のiPhone 15。画面が割れ、画面交換後、タッチ操作と起動を確認しました。'},
  facts:{area:{name:'水戸市',slug:'mito'},device:{name:'iPhone 15',slug:'iphone15'},uncertain:[]},
  media:[{id:'p1',privacyCheck:'pending',contentMatch:'pending',original:'synthetic://image1'}],
  drafts:{hp:null,gbp:null},
  approval:{hp:{state:'draft'},gbp:{state:'draft'}},
  publishLog:{hp:null,gbp:null}
 };
}
function setup({enableImport=false,enableDraft=false,enableSync=false,consent=false,
  incomplete=false,photoCount=1,hold=false}={}){
 const props=new Map(Object.entries({
  OSH_LEGACY_AUTO_IMPORT_ENABLED:String(enableImport),
  OSH_LEGACY_AUTO_START_ROW:'10',OSH_LEGACY_AUTO_MAX_PER_TICK:'2',
  OSH_LEGACY_AUTO_DRAFT_ENABLED:String(enableDraft),
  OSH_LEGACY_SYNC_ENABLED:String(enableSync),
  OSH_LEGACY_SYNC_START_AFTER:'2026-11-19T00:00:00+09:00',
  OSH_LEGACY_SYNC_MAX_PER_TICK:'2',
  OSH_LEGACY_AI_START_AFTER:'2026-11-19T00:00:00+09:00',
  AI_DATA_SHARING_APPROVED:String(consent),
  ANTHROPIC_API_KEY:'SYNTHETIC-FAKE-KEY',
  ANTHROPIC_MODEL:'mock-only',
  MAX_AI_CALLS_PER_DAY:'1',
  EXCHANGE_IDS:JSON.stringify({intake:'mock-intake-folder',drafts:'mock-draft-folder'}),
  HOLD_REPORT_IDS:hold?REPORT_ID:''
 }));
 const ledger={};const reportRows=[];const intakeFiles=[];const draftFiles=[];
 const calls={import:0,ai:0,draft:0,sync:0,otherWrites:0,auth:0};
 const p={getProperty:key=>props.get(key)??null,setProperty:(key,val)=>props.set(key,val)};
 const context=vm.createContext({
  CONFIG:{MODE:'production',RESPONSE_SPREADSHEET_ID:'mock-source',
   KEY_PREFIX:'sent_',MAX_PHOTOS:5},
  PropertiesService:{getScriptProperties:()=>p},
  requireApprover_:()=>{calls.auth++;return 'mock-owner'},
  responseSheet_:()=>({getLastRow:()=>10}),
  getLayout_:()=>({}),
  readReport_:()=>({timestampKey:CREATED,photoIds:
   Array.from({length:photoCount},(_,i)=>'synthetic-photo-'+(i+1))}),
  reportKey_:()=>REPORT_KEY,
  importedKeys_:()=>ledger,
  apiImport:key=>{
    calls.import++;
    assert.equal(key,REPORT_KEY);
    const r=syntheticReport();
    reportRows.push({report:r,revision:1});
    intakeFiles.push({id:'mock-file-id',name:REPORT_ID+'.json',createdTime:CREATED,report:r});
    ledger[REPORT_KEY]=REPORT_ID;
    return {reportId:REPORT_ID};
  },
  readDrafts_:()=>reportRows,
  readDraftFiles_:()=>draftFiles,
  Drive:{Files:{list:()=>({files:intakeFiles.map(({id,name,createdTime})=>({id,name,createdTime}))})}},
  DriveApp:{getFileById:id=>({
    getBlob:()=>({getDataAsString:()=>JSON.stringify(intakeFiles.find(f=>f.id===id)?.report)})
  })},
  UrlFetchApp:{fetch:(url,request)=>{
    calls.ai++;
    assert.equal(url,'https://api.anthropic.com/v1/messages');
    const prompt=JSON.parse(request.payload).messages[0].content;
    assert.match(prompt,/iPhone 15/);
    assert.doesNotMatch(prompt,/synthetic:\/\/image1|SYNTHETIC-FAKE-KEY/);
    return {getResponseCode:()=>200,
      getContentText:()=>JSON.stringify({content:[{type:'text',text:JSON.stringify(
        incomplete?{...mockAi(),ready:false}:mockAi()
      )}]})};
  }},
  Utilities:{formatDate:(_date,_tz,format)=>format==='yyyyMMdd'?'20261119':DATE},
  applyDraft_:(row,patch)=>{
    if(patch.reportId!==row.reportId||patch.drafts.hp.titleDevice!=='iPhone 15')
      return ['report mismatch'];
    if(row.approval.hp.state!=='draft'||row.publishLog.hp!=null)
      return ['not eligible'];
    return [];
  },
  createFile_:(folder,name,blob)=>{
    assert.equal(folder,'mock-draft-folder');
    assert.equal(name,REPORT_ID+'.json');
    draftFiles.push({name,updated:UPDATED,data:blob.content,older:false});
    calls.draft++;
  },
  jsonBlob_:(name,patch)=>({name,content:patch}),
  withLock_:fn=>fn(),
  loadDraft_:(rows,patch,meta,_owner,result)=>{
    const row=rows.find(x=>x.report.reportId===patch.reportId);
    if(!row || row.report.drafts.hp)throw new Error('already written');
    const problems=context.applyDraft_(row.report,patch);
    if(problems.length)throw new Error('schema mismatch');
    row.report={...row.report, status:'draft',
      drafts:JSON.parse(JSON.stringify(patch.drafts)),
      facts:{...row.report.facts,...JSON.parse(JSON.stringify(patch.facts))}};
    row.revision++;
    result.applied.push(patch.reportId);
    calls.sync++;
  },
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Logger:{log:()=>{}},Date,JSON
 });
 code.forEach((source,i)=>vm.runInContext(source,context,{filename:'pipeline-'+i+'.gs',timeout:1000}));
 const run=name=>vm.runInContext(name+'()',context,{timeout:1000});
 return {run,props,calls,reportRows,intakeFiles,draftFiles,context};
}
test('all OFF causes zero import, AI, sync or network activity',()=>{
 const x=setup();
 assert.equal(x.run('oshLegacyAutoImportTick').status,'disabled');
 assert.equal(x.run('oshLegacyAutoDraftTick').status,'disabled');
 assert.equal(x.run('oshLegacySafeSyncTick').state,'disabled');
 assert.deepEqual(x.calls,{import:0,ai:0,draft:0,sync:0,otherWrites:0,auth:0});
});
test('one synthetic staff report goes through mock AI into draft; never publishes',()=>{
 const x=setup({enableImport:true,enableDraft:true,enableSync:true,consent:true});
 assert.equal(x.run('oshLegacyAutoImportTick').imported,1);
 assert.equal(x.reportRows.length,1);
 assert.equal(x.run('oshLegacyAutoDraftTick').generated,1);
 assert.equal(x.draftFiles.length,1);
 const patch=x.draftFiles[0].data;
 assert.equal(patch.drafts.hp.titleArea,'水戸市');
 assert.match(patch.drafts.hp.slug,/2026-11-19-mito-iphone15/);
 assert.equal(patch.drafts.hp.sections.length,3);
 assert.deepEqual(JSON.parse(JSON.stringify(patch.media)),[]);
 assert.ok(!('approval'in patch));assert.ok(!('publishLog'in patch));
 assert.equal(x.run('oshLegacySafeSyncTick').applied,1);
 const r=x.reportRows[0].report;
 assert.equal(r.approval.hp.state,'draft');
 assert.equal(r.approval.gbp.state,'draft');
 assert.equal(r.publishLog.hp,null);assert.equal(r.publishLog.gbp,null);
 assert.equal(r.media[0].privacyCheck,'pending');
 assert.equal(r.media[0].contentMatch,'pending');
 assert.equal(x.calls.import,1);assert.equal(x.calls.ai,1);
 assert.equal(x.calls.draft,1);assert.equal(x.calls.sync,1);
 assert.equal(x.run('oshLegacyAutoImportTick').imported,0);
 assert.equal(x.run('oshLegacyAutoDraftTick').generated,0);
 assert.equal(x.run('oshLegacySafeSyncTick').applied,0);
 assert.equal(x.calls.import,1);assert.equal(x.calls.ai,1);
});
test('consent false blocks AI even after synthetic report is imported',()=>{
 const x=setup({enableImport:true,enableDraft:true,enableSync:true});
 assert.equal(x.run('oshLegacyAutoImportTick').imported,1);
 assert.throws(()=>x.run('oshLegacyAutoDraftTick'),/許可/);
 assert.equal(x.calls.ai,0);assert.equal(x.calls.draft,0);
 assert.equal(x.run('oshLegacySafeSyncTick').applied,0);
 assert.equal(x.reportRows[0].report.approval.hp.state,'draft');
});
test('held case does not enter AI or sync, even when synthetic report is imported',()=>{
 const x=setup({enableImport:true,enableDraft:true,enableSync:true,consent:true,hold:true});
 assert.equal(x.run('oshLegacyAutoImportTick').imported,1);
 assert.equal(x.run('oshLegacyAutoDraftTick').generated,0);
 assert.equal(x.run('oshLegacySafeSyncTick').applied,0);
 assert.equal(x.calls.ai,0);
});
test('incomplete repair must be held before any draft is written',()=>{
 const x=setup({enableImport:true,enableDraft:true,enableSync:true,consent:true,incomplete:true});
 x.run('oshLegacyAutoImportTick');
 assert.equal(x.run('oshLegacyAutoDraftTick').generated,0);
 assert.equal(x.run('oshLegacySafeSyncTick').applied,0);
 assert.equal(x.props.get('OSH_LEGACY_AI_HOLD_'+REPORT_ID),'true');
});
test('missing photos stops import and prevents all downstream work',()=>{
 const x=setup({enableImport:true,enableDraft:true,enableSync:true,consent:true,photoCount:0});
 assert.throws(()=>x.run('oshLegacyAutoImportTick'),/停止/);
 assert.equal(x.props.get('OSH_LEGACY_AUTO_HALTED'),'true');
 assert.equal(x.reportRows.length,0);assert.equal(x.calls.ai,0);
 assert.equal(x.calls.sync,0);
});

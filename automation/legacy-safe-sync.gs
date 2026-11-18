/**
 * Existing GAS auto-sync adapter: OFF by default. Never publish.
 * Reads imported report drafts and applies only new, eligible files using the
 * existing loadDraft_ routine. Requires the signed-in owner.
 */
const OSH_LEGACY_SYNC_HOLD=['R-20261117-f5586927','R-20261117-83fc7631'];
function oshLegacySyncConfig_(p){
 const value=p.getProperty('OSH_LEGACY_SYNC_START_AFTER');
 const startMs=Date.parse(value||'');
 const n=p.getProperty('OSH_LEGACY_SYNC_MAX_PER_TICK');
 const max=n==null?2:Number(n);
 if(!value||!Number.isFinite(startMs))throw new Error('同期開始日時が不正です');
 if(!Number.isInteger(max)||max<1||max>3)throw new Error('処理件数は1〜3件');
 return {startMs,max,hold:new Set(OSH_LEGACY_SYNC_HOLD.concat(
   String(p.getProperty('HOLD_REPORT_IDS')||'').split(',').map(s=>s.trim()).filter(Boolean)))};
}
function oshLegacySyncEligible_(r,f,c){
 if(!r||!f||!f.data||f.older||f.error)return false;
 const id=r.reportId;
 if(!/^R-\d{8}-[a-z0-9]{8}$/i.test(id||'')||f.data.reportId!==id||c.hold.has(id))return false;
 const updated=Date.parse(f.updated||'');
 const startDay=new Date(c.startMs+9*3600000).toISOString().slice(0,10).replace(/-/g,'');
 if(!Number.isFinite(updated)||updated<=c.startMs||id.slice(2,10)<startDay)return false;
 return r.source?.mode==='production'&&r.status==='needs-draft'&&!r.drafts?.hp&&
   r.approval?.hp?.state==='draft'&&!r.publishLog?.hp&&!r.exported;
}
function oshLegacySafeSyncTick(){
 const p=PropertiesService.getScriptProperties();
 if(p.getProperty('OSH_LEGACY_SYNC_ENABLED')!=='true')return {state:'disabled',applied:0};
 if(p.getProperty('OSH_LEGACY_SYNC_HALTED')==='true')throw new Error('以前の自動同期エラーを確認するまで停止しています');
 if(typeof requireApprover_!=='function'||typeof withLock_!=='function'||
   typeof readDrafts_!=='function'||typeof readDraftFiles_!=='function'||
   typeof loadDraft_!=='function'||typeof CONFIG==='undefined'||CONFIG.MODE!=='production')
   throw new Error('既存の承認機能と接続できません');
 const owner=requireApprover_(),config=oshLegacySyncConfig_(p);
 return withLock_(()=>{
  const drafts=readDrafts_();
  const byId=new Map(drafts.map(d=>[d.report.reportId,d.report]));
  const files=readDraftFiles_();
  const eligible=files.filter(f=>oshLegacySyncEligible_(byId.get(f.data?.reportId),f,config))
    .sort((a,b)=>Date.parse(a.updated)-Date.parse(b.updated));
  const result={found:[],applied:[],skipped:[],errors:[]};
  for(const f of eligible.slice(0,config.max)){
   result.found.push(f.name);
   try{
    loadDraft_(drafts,f.data,{name:f.name,updated:f.updated},owner,result);
    if(result.errors.length)throw Error('既存の検証で不一致');
   }catch(e){
    p.setProperty('OSH_LEGACY_SYNC_HALTED','true');
    Logger.log('下書き自動同期を停止: 管理画面で確認してください');
    throw new Error('下書きの自動反映を停止しました');
   }
  }
  return {state:'checked',applied:result.applied.length,reportIds:result.applied};
 });
}
function oshLegacyReviewInbox(){
 requireApprover_();
 const p=PropertiesService.getScriptProperties(),c=oshLegacySyncConfig_(p);
 return readDrafts_().filter(d=>{
  const r=d.report;
  return r?.drafts?.hp&&r.drafts.gbp&&r.approval?.hp?.state==='draft'&&
   r.source?.mode==='production'&&!r.publishLog?.hp&&!r.exported&&!c.hold.has(r.reportId)&&
   Date.parse(r.draftSource?.updated||'')>c.startMs;
 }).slice(-30).map(d=>({
  reportId:d.report.reportId,revision:d.revision,
  title:(d.report.drafts.hp.titleDevice||'機種未確認')+'の修理事例',
  needsPhotoReview:(d.report.media||[]).some(m=>m.privacyCheck!=='ok'||m.contentMatch!=='ok'||!m.alt)
 }));
}

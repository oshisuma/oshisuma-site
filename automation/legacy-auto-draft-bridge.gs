/**
 * 本番の「承認.gs」「受け渡し.gs」に適合するAI下書き生成アダプター。
 * 【未導入・初期OFF】既存の管理シート行を直接作成/編集しない。
 * 既存 apiImport → intake/ に保存された報告だけを読み込み、
 * AI差分下書きを drafts/ に作成。既存 apiSyncDrafts() が管理シートに適用する。
 *
 * 事前条件: 本番既存共通.gs, 受け渡し.gs, 承認.gs, legacy-ai-runtime.gs,
 * legacy-draft-payload.gs が同一スクリプトにあること。
 * 定期実行の本人認証が取得できない場合は停止し、認証を迂回しない。
 *
 * Properties:
 * OSH_LEGACY_AUTO_DRAFT_ENABLED=false
 * AI_DATA_SHARING_APPROVED=false   // 顧客情報の外部AI送信には明確な許可が必要
 * OSH_LEGACY_AI_START_AFTER        // ISO8601。以前に保存した案件は触らない
 * HOLD_REPORT_IDS                 // 追加の公開保留案件の報告ID
 * ANTHROPIC_API_KEY, ANTHROPIC_MODEL, MAX_AI_CALLS_PER_DAY
 * OSH_LEGACY_AUTO_DRAFT_HALTED=false
 */
function oshLegacyDraftFiles_(folderId,cutoffMs) {
  const files=[];
  let token=null,pages=0;
  do {
    const opts={
      q:"'"+folderId+"' in parents and mimeType = 'application/json' and trashed = false",
      fields:'nextPageToken,files(id,name,createdTime)',
      pageSize:100,orderBy:'createdTime desc'
    };
    if(token)opts.pageToken=token;
    const result=Drive.Files.list(opts);
    for(const f of result.files||[]) {
      if(!/^R-\d{8}-[a-z0-9]{8}\.json$/i.test(f.name||''))continue;
      const created=Date.parse(f.createdTime||'');
      if(Number.isFinite(created)&&created>cutoffMs)files.push(f);
    }
    token=result.nextPageToken||null;
    pages++;
    if(pages>=20 && token)throw new Error('報告ファイルが多いため、読み取り件数の上限に達しました');
  }while(token);
  return files.sort((a,b)=>Date.parse(a.createdTime)-Date.parse(b.createdTime));
}
function oshLegacyNeedsPrivacyReview_(r) {
  const notes=Array.isArray(r.facts?.uncertain)?r.facts.uncertain:[];
  const input=String(r.intake?.reportText||'');
  // AIの正規表現マスクだけでは顧客氏名、住所、識別番号を完全には消せない。
  // 人の名前・住所・連絡先が疑われる報告は送信せず保留。
  return notes.some(x=>/電話番号|メールアドレス|住所|人の名前|個人情報/.test(String(x))) ||
    /〒|\d{3}-\d{4}|丁目|番地|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|0\d{1,4}[-‐－ー]\d{1,4}[-‐－ー]\d{3,4}/i.test(input);
}
function oshLegacyAutoDraftTick() {
  const p=PropertiesService.getScriptProperties();
  if(p.getProperty('OSH_LEGACY_AUTO_DRAFT_ENABLED')!=='true')
    return {status:'disabled',generated:0};
  if(p.getProperty('OSH_LEGACY_AUTO_DRAFT_HALTED')==='true')
    throw new Error('前回の異常からAI自動生成を停止しています。状況の確認が必要です');
  if(p.getProperty('AI_DATA_SHARING_APPROVED')!=='true')
    throw new Error('顧客の報告文を外部AIへ送信する許可がありません');
  if(typeof CONFIG==='undefined'||CONFIG.MODE!=='production'||
     typeof requireApprover_!=='function'||
     typeof readDrafts_!=='function'||typeof readDraftFiles_!=='function'||
     typeof oshLegacyAiGenerate_!=='function'||typeof oshLegacyAiBudget_!=='function'||
     typeof oshLegacyCreateDraftPatch_!=='function'||
     typeof applyDraft_!=='function'||typeof createFile_!=='function'||
     typeof jsonBlob_!=='function')
    throw new Error('既存の本番管理機能との接続が不完全です');
  requireApprover_();
  const apiKey=p.getProperty('ANTHROPIC_API_KEY'),model=p.getProperty('ANTHROPIC_MODEL');
  const cutoffMs=Date.parse(p.getProperty('OSH_LEGACY_AI_START_AFTER')||'');
  const exchangeRaw=p.getProperty('EXCHANGE_IDS');
  if(!apiKey||!model||!Number.isFinite(cutoffMs)||!exchangeRaw)
    throw new Error('AIの設定、開始日時、既存フォルダの設定が不足しています');
  const exchange=JSON.parse(exchangeRaw);
  if(!exchange.intake||!exchange.drafts)
    throw new Error('既存の受け渡し用フォルダ設定が正しくありません');
  const held=new Set([
    'R-20261117-f5586927','R-20261117-83fc7631',
    ...String(p.getProperty('HOLD_REPORT_IDS')||'').split(',').map(x=>x.trim()).filter(Boolean)
  ]);
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))return {status:'locked',generated:0};
  const generated=[],skipped=[],review=[];
  try {
    const known=new Map(readDrafts_().map(x=>[x.report.reportId,x.report]));
    const pending=new Set(readDraftFiles_().filter(x=>x.data&&x.data.reportId).map(x=>x.data.reportId));
    const queue=oshLegacyDraftFiles_(exchange.intake,cutoffMs);
    const settings={apiKey,model};
    for(const file of queue) {
      if(generated.length>=1)break; // APIの費用や大量送信のリスクを抑え、初期は1回1件
      const id=file.name.slice(0,-5);
      if(held.has(id)||pending.has(id)||p.getProperty('OSH_LEGACY_AI_HOLD_'+id)==='true'){
        skipped.push(id);continue;
      }
      const row=known.get(id);
      if(!row || row.source?.mode!=='production' ||
         row.status!=='needs-draft' || row.approval?.hp?.state!=='draft' ||
         row.drafts?.hp||row.publishLog?.hp) {
        skipped.push(id);continue;
      }
      let report;
      try { report=JSON.parse(DriveApp.getFileById(file.id).getBlob().getDataAsString('UTF-8')); }
      catch(e){p.setProperty('OSH_LEGACY_AUTO_DRAFT_HALTED','true');throw new Error('報告JSONを読めないためAI自動処理を停止しました: '+id);}
      if(report.reportId!==id||report.source?.key!==row.source?.key||
         report.status!=='needs-draft'||report.drafts?.hp||
         !report.intake?.reportText||!report.facts?.device?.name||!report.facts?.area?.name){
        p.setProperty('OSH_LEGACY_AUTO_DRAFT_HALTED','true');
        throw new Error('管理シートと元報告が一致しないため停止しました: '+id);
      }
      if(oshLegacyNeedsPrivacyReview_(report)){
        p.setProperty('OSH_LEGACY_AI_HOLD_'+id,'true');
        review.push(id);continue;
      }
      // APIへの通信はこの行より上の全条件、明確な許可、日次上限を通った場合のみ。
      if(!oshLegacyAiBudget_(p))break;
      let ai,patch;
      try {
        ai=oshLegacyAiGenerate_(report,settings);
        patch=oshLegacyCreateDraftPatch_(report,ai,
          Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd'));
        if(!patch){
          p.setProperty('OSH_LEGACY_AI_HOLD_'+id,'true');
          review.push(id);continue; // 相談のみ・修理未完了。記事化しない
        }
        // 本番のapplyDraft_をコピー上だけで実行してスキーマ・禁止表現を照合する。
        // 既存の管理シートにはこの段階で一切書き込まない。
        const check=JSON.parse(JSON.stringify(row));
        const problems=applyDraft_(check,patch);
        if(problems.length)throw new Error('下書き確認エラー: '+problems.join(' / '));
        createFile_(exchange.drafts,id+'.json',jsonBlob_(id+'.json',patch));
        generated.push(id);pending.add(id);
      } catch(e) {
        p.setProperty('OSH_LEGACY_AUTO_DRAFT_HALTED','true');
        Logger.log('AI下書きを安全停止しました。報告ID：'+id);
        throw new Error('AI下書き生成または保存でエラーが発生したため停止しました。報告ID：'+id);
      }
    }
    return {status:'checked',generated:generated.length,reportIds:generated,reviewIds:review,skipped:skipped.length};
  }finally{lock.releaseLock();}
}

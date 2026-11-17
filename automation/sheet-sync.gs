/**
 * Driveの drafts から既存の承認用スプレッドシート「下書き」に自動登録。
 * 試験用・初期OFF。既存の行は更新も上書きもしない。
 * Script Properties: AUTO_DRAFT_SHEET_SYNC_ENABLED,
 * HANDOFF_FOLDER_ID, MANAGEMENT_SPREADSHEET_ID, HOLD_REPORT_IDS, AUTO_START_AFTER
 */
function oshAutoDraftSheetSyncTick() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('AUTO_DRAFT_SHEET_SYNC_ENABLED') !== 'true') return;
  const rootId = p.getProperty('HANDOFF_FOLDER_ID');
  const sheetId = p.getProperty('MANAGEMENT_SPREADSHEET_ID');
  const cut = Date.parse(p.getProperty('AUTO_START_AFTER') || '');
  if (!rootId || !sheetId || !Number.isFinite(cut))
    throw new Error('承認シート同期の設定が不足しています');
  const held = new Set(String(p.getProperty('HOLD_REPORT_IDS') || '').split(',').map(s=>s.trim()).filter(Boolean));
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const folder = oshSyncFindFolder_(DriveApp.getFolderById(rootId), 'drafts');
    const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('下書き');
    if (!sheet) throw new Error('管理シート「下書き」が見つかりません');
    const headers = sheet.getRange(1,1,1,6).getValues()[0].map(String);
    if (JSON.stringify(headers) !== JSON.stringify(['報告ID','版','HP','Google','報告データ（JSON）','更新日時']))
      throw new Error('管理シートの列名が変更されたため停止');
    const known = new Set(sheet.getLastRow() > 1 ?
      sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues().map(r=>String(r[0])) : []);
    const files = folder.getFiles();
    let imported = 0;
    while(files.hasNext() && imported < 3) {
      const file = files.next();
      if(file.getDateCreated().getTime() <= cut) continue;
      if(!/^R-\d{8}-[a-z0-9]{8}\.json$/i.test(file.getName())) continue;
      const id = file.getName().replace(/\.json$/i,'');
      if(held.has(id) || known.has(id)) continue;
      let data;
      try { data = JSON.parse(file.getBlob().getDataAsString('utf-8')); }
      catch(e) { throw new Error('下書きJSONが不正: '+id); }
      oshSyncValidate_(data,id);
      // 誤って公開承認済みのデータを取り込まない。
      const now = new Date().toISOString();
      sheet.appendRow([id,1,'draft','draft',JSON.stringify(data),now]);
      known.add(id);
      imported++;
    }
  } finally {lock.releaseLock();}
}
function oshSyncFindFolder_(parent,name) {
  const f=parent.getFoldersByName(name);
  if(!f.hasNext())throw new Error('指定フォルダなし: '+name);
  return f.next();
}
function oshSyncValidate_(d,id) {
  if(!d || d.reportId !== id || d.source?.mode !== 'production' ||
    !['hold','needs-photo-review'].includes(d.status) ||
    d.approval?.hp?.state !== 'draft' || d.approval?.gbp?.state !== 'draft' ||
    d.publishLog?.hp || d.publishLog?.gbp)
    throw new Error('未承認の安全な下書きではありません: '+id);
  if(!d.facts?.device?.name || !d.facts?.area?.name ||
      !Array.isArray(d.media) ||
      !d.media.every(m=>m.privacyCheck==='pending' && m.contentMatch==='pending'))
    throw new Error('写真が未確認の安全な形式ではありません: '+id);
  if(d.status === 'needs-photo-review' && (!d.drafts?.hp || !d.drafts?.gbp))
    throw new Error('HPまたはGoogle用の下書きが欠落: '+id);
}
/** インストール済みの管理GASに統合した後の定期実行候補。
 * 3つの処理は各スイッチが個別にOFF。実運用では一つずつ検証してONにする。
 */
function oshAutoPipelineTick() {
  if(typeof oshAutoIntakeTick === 'function') oshAutoIntakeTick();
  if(typeof oshAutoTick === 'function') oshAutoTick();
  oshAutoDraftSheetSyncTick();
}

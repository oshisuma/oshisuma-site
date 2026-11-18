/**
 * Driveの drafts から既存の承認用スプレッドシート「下書き」に自動登録。
 * 試験用・初期OFF。既存の行は更新も上書きもしない。
 * Script Properties: AUTO_DRAFT_SHEET_SYNC_ENABLED,
 * HANDOFF_FOLDER_ID, MANAGEMENT_SPREADSHEET_ID, HOLD_REPORT_IDS, AUTO_START_AFTER
 */
function oshAutoDraftSheetSyncTick() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('AUTO_DRAFT_SHEET_SYNC_ENABLED') !== 'true') return;
  // 本番承認.gsはapiImportで管理シートに行を作り、apiSyncDraftsで同じ行へ下書きを適用する。
  // 別方式でappendRowすると管理上の報告キーがずれる危険があるため拒否する。
  if (typeof apiSyncDrafts === 'function')
    throw new Error('既存のapiSyncDraftsがあるため、別方式の管理シート同期を停止しました');
  const rootId = p.getProperty('HANDOFF_FOLDER_ID');
  const sheetId = p.getProperty('MANAGEMENT_SPREADSHEET_ID');
  const cut = Date.parse(p.getProperty('AUTO_START_AFTER') || '');
  if (!rootId || !sheetId || !Number.isFinite(cut))
    throw new Error('承認シート同期の設定が不足しています');
  const held = new Set(String(p.getProperty('HOLD_REPORT_IDS') || '').split(',').map(s=>s.trim()).filter(Boolean));
  const notifyTo = p.getProperty('OWNER_EMAIL');
  const approvalUrl = p.getProperty('APPROVAL_URL');
  if (!notifyTo || !/^https:\/\//.test(approvalUrl || ''))
    throw new Error('通知メール先・承認画面のURLが未設定です');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const folder = oshSyncFindFolder_(DriveApp.getFolderById(rootId), 'drafts');
    const sheet = SpreadsheetApp.openById(sheetId).getSheetByName('下書き');
    if (!sheet) throw new Error('管理シート「下書き」が見つかりません');
    const headers = sheet.getRange(1,1,1,6).getValues()[0].map(String);
    if (JSON.stringify(headers) !== JSON.stringify(['報告ID','版','HP','Google','報告データ（JSON）','更新日時']))
      throw new Error('管理シートの列名が変更されたため停止');
    const existingRows = sheet.getLastRow() > 1 ?
      sheet.getRange(2,1,sheet.getLastRow()-1,6).getValues() : [];
    const known = new Set(existingRows.map(r => String(r[0])));
    // 途中失敗で通知が届かなかった下書きだけ、次回の実行で再送する。
    // 既に承認・公開・差し戻しされたものは通知しない。
    for (const row of existingRows) {
      const id = String(row[0] || '');
      if (!id || held.has(id) || row[2] !== 'draft' || row[3] !== 'draft') continue;
      let draft;
      try { draft = JSON.parse(String(row[4] || '{}')); } catch (_) { continue; }
      if (!oshSyncNotifyEligible_(draft, id)) continue;
      oshSyncNotify_(p, notifyTo, approvalUrl, draft);
    }
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
      oshSyncNotify_(p, notifyTo, approvalUrl, data);
    }
  } finally {lock.releaseLock();}
}
function oshSyncNotifyEligible_(d,id) {
  return d && d.reportId === id &&
    d.source?.mode === 'production' &&
    d.status === 'draft' &&
    ['hold','needs-photo-review'].includes(d.workflow?.stage) &&
    d.approval?.hp?.state === 'draft' &&
    d.approval?.gbp?.state === 'draft' &&
    !d.publishLog?.hp && !d.publishLog?.gbp;
}
function oshSyncNotify_(p, to, url, draft) {
  const key = 'OSH_AUTO_SYNC_NOTIFY_' + draft.reportId;
  if (p.getProperty(key) === 'true') return;
  if (!oshSyncNotifyEligible_(draft, draft.reportId)) return;
  const isHold = draft.workflow?.stage === 'hold';
  const subject = isHold ? '【オシスマ】確認が必要な修理報告' : '【オシスマ】修理事例の下書きを保存しました';
  // プレビュー完成ではないことを明示する。公開操作に直接つながる承認リンクは送らない。
  MailApp.sendEmail(to, subject,
    '機種：' + draft.facts.device.name + '\n' +
    (isHold ? '確認事項があります。修理完了とは扱っていません。' :
      'HP・Google用の文章下書きを管理シートに登録しました。') +
    '\n写真の確認・完成プレビュー・最終承認はまだです。' +
    '\n管理画面：' + url + '\n\nHP・Googleへは公開していません。');
  p.setProperty(key,'true');
}
function oshSyncFindFolder_(parent,name) {
  const f=parent.getFoldersByName(name);
  if(!f.hasNext())throw new Error('指定フォルダなし: '+name);
  return f.next();
}
/**
 * AIが作ったHP/Google下書きの事実関係を、管理シート登録前に独立確認。
 * 公開判定ではない。写真の個人情報判定は別で必要。
 * 「回答にない修理をタイトルに加える」等を止める。スタッフ報告との意味的一致は別途人が確認する。
 */
function oshSyncNormalizeDevice_(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
}
function oshSyncValidateContent_(d) {
  const hp=d.drafts && d.drafts.hp, gbp=d.drafts && d.drafts.gbp;
  const facts=d.facts || {};
  const fail=reason=>{throw new Error('AI下書きの内容を確認してください：'+reason);};
  if (!hp || !gbp || !Array.isArray(facts.works) || !facts.works.length)
    fail('修理内容またはHP・Google下書きがありません');
  if (!hp.titleDevice || oshSyncNormalizeDevice_(hp.titleDevice)!==oshSyncNormalizeDevice_(facts.device?.name))
    fail('タイトルの機種がスタッフ報告と一致しません');
  if (String(hp.titleArea||'')!==String(facts.area?.name||''))
    fail('記事の地域がスタッフ報告と一致しません');
  if (!Array.isArray(hp.titleServices) || !hp.titleServices.length ||
      !hp.titleServices.every(s=>typeof s==='string' && facts.works.includes(s)))
    fail('タイトルに報告されていない対応内容が含まれています');
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(hp.slug||'') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(hp.date||''))
    fail('掲載日または記事URLの形式が不正です');
  if (hp.slug.slice(0,10)!==hp.date)fail('記事URLの日付が掲載日と異なります');
  if (!hp.description || !hp.cardSummary || !Array.isArray(hp.sections) || !hp.sections.length)
    fail('記事の基本情報が不足しています');
  const texts=[hp.description,hp.cardSummary];
  for(const s of hp.sections) {
    if(!s || typeof s.heading!=='string' || !Array.isArray(s.paragraphs) ||
       !s.paragraphs.length)fail('本文の構造が不正です');
    texts.push(s.heading);
    for(const paragraph of s.paragraphs) {
      if(typeof paragraph!=='string' || !paragraph.trim())fail('本文に未対応の形式または空欄があります');
      texts.push(paragraph);
    }
  }
  if(typeof gbp.summary!=='string' || !gbp.summary.trim() ||
     gbp.summary.length>1500)fail('Google投稿文が空欄または長すぎます');
  const hpText=texts.join('\n');
  const prohibited=/(?:[0-9０-９,，]+\s*円|¥|￥|税込|税抜)/;
  if(prohibited.test(hpText)||prohibited.test(gbp.summary))
    fail('価格情報が本文に含まれています');
  if(/(?:https?:\/\/|\btel:)/i.test(gbp.summary) ||
     /0\d{1,4}[-‐－ー]?\d{1,4}[-‐－ー]?\d{3,4}/.test(gbp.summary))
    fail('Google投稿文にURLまたは電話番号が含まれています');
  // 完了したことが明確でない案件は needs-photo-review へ進めない。
  if(!facts.result || !String(facts.result).trim())
    fail('修理結果が未確認です');
}
function oshSyncValidate_(d,id) {
  if(!d || d.reportId !== id || d.source?.mode !== 'production' ||
    d.status !== 'draft' ||
    !['hold','needs-photo-review'].includes(d.workflow?.stage) ||
    d.approval?.hp?.state !== 'draft' || d.approval?.gbp?.state !== 'draft' ||
    d.publishLog?.hp || d.publishLog?.gbp)
    throw new Error('未承認の安全な下書きではありません: '+id);
  if(!d.facts?.device?.name || !d.facts?.area?.name ||
      !Array.isArray(d.media) ||
      !d.media.every(m=>m.privacyCheck==='pending' && m.contentMatch==='pending'))
    throw new Error('写真が未確認の安全な形式ではありません: '+id);
  if(d.workflow?.stage === 'needs-photo-review') {
    if(!d.drafts?.hp || !d.drafts?.gbp)
      throw new Error('HPまたはGoogle用の下書きが欠落: '+id);
    oshSyncValidateContent_(d);
  }
}
/** インストール済みの管理GASに統合した後の定期実行候補。
 * 3つの処理は各スイッチが個別にOFF。実運用では一つずつ検証してONにする。
 */
function oshAutoPipelineTick() {
  if(typeof oshAutoIntakeTick === 'function') oshAutoIntakeTick();
  if(typeof oshAutoTick === 'function') oshAutoTick();
  oshAutoDraftSheetSyncTick();
}

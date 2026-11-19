/**
 * 本番の「共通.gs」「承認.gs」「受け渡し.gs」に合わせた読取専用の接続診断。
 * 【本番未導入】既存の権限スコープを広げず、既存のフォーム回答・管理シート・Driveの構造を確認。
 * フォルダ未作成でも新規に作らない（exchangeFolders_ はここでは絶対に呼ばない）。
 * 申請情報、メールアドレス、ファイルID、写真、報告原文、APIキーは返さない。
 */
function oshLegacyDiagResult_(key,ok,message,level) {
  return {key:key,ok:!!ok,message:message,level:ok?'ok':(level||'error')};
}
function oshLegacyReadOnlyPreflight() {
  // Webアプリから呼ばれても本人確認は既存のrequireApprover_から必ず行う。
  requireApprover_();
  const p=PropertiesService.getScriptProperties();
  const val=name=>String(p.getProperty(name)||'').trim();
  const checks=[];
  const add=(key,ok,msg,level)=>checks.push(oshLegacyDiagResult_(key,ok,msg,level));
  if(typeof CONFIG==='undefined'||CONFIG.MODE!=='production')
    throw new Error('本番用スクリプトではないため接続診断を停止しました');
  const off=[
    'AUTO_INTAKE_ENABLED','AUTO_DRAFT_ENABLED','AUTO_DRAFT_SHEET_SYNC_ENABLED',
    'OSH_LEGACY_AUTO_IMPORT_ENABLED','OSH_LEGACY_AUTO_DRAFT_ENABLED',
    'OSH_LEGACY_SYNC_ENABLED'
  ].every(key=>val(key)!=='true');
  add('legacy-switches-off',off,'本番への新しい自動処理はまだすべて停止状態である');
  add('consent-off',val('AI_DATA_SHARING_APPROVED')!=='true',
    '外部AIへの顧客報告送信は未承認のまま停止している');
  const ss=book_(); // 管理シート（権限はspreadsheets.currentonly）
  const drafts=ss.getSheetByName(TAB_DRAFTS);
  const ledger=ss.getSheetByName(TAB_LEDGER);
  const logs=ss.getSheetByName(TAB_LOG);
  const hasHeaders=(sheet,expected)=>{
    if(!sheet||sheet.getLastColumn()<expected.length)return false;
    const got=sheet.getRange(1,1,1,expected.length).getValues()[0].map(String);
    return expected.every((x,i)=>got[i]===x);
  };
  add('management-drafts',hasHeaders(drafts,DRAFT_HEADERS),'管理シート「下書き」の見出し');
  add('management-ledger',hasHeaders(ledger,IMPORT_HEADERS),'管理シート「取り込み済み」の見出し');
  add('management-log',hasHeaders(logs,LOG_HEADERS),'管理シート「操作の記録」の見出し');
  let response;
  try{
    response=responseSheet_(); // 既存のSheets拡張サービスで回答シートを読み取るだけ
    const layout=getLayout_(response);
    add('response-layout',!!layout.map.timestamp.length&&
      !!layout.map.model.length&&!!layout.map.details.length&&
      !!layout.map.photos.length,'フォーム回答の必須項目・写真列が読み取れる');
  }catch(e){
    add('response-layout',false,'フォーム回答シートを読み取れる');
  }
  const raw=val('EXCHANGE_IDS');
  let folderIds=null;
  try{
    const parsed=JSON.parse(raw);
    if(parsed&&['root','intake','drafts','photos','approved'].every(x=>
      typeof parsed[x]==='string' && parsed[x].length>5))
      folderIds=parsed;
  }catch(e){ /* 未設定は不足と表示 */ }
  add('handoff-ids',!!folderIds,'既存の受け渡し用Driveフォルダ情報が保存されている');
  if(folderIds){
    for(const [name,label] of Object.entries({
      root:CONFIG.EXCHANGE_FOLDER_NAME,
      intake:'intake',drafts:'drafts',photos:'photos',approved:'approved'
    })){
      let ok=false;
      try{
        const meta=Drive.Files.get(folderIds[name],{
          fields:'name,mimeType,trashed'
        });
        ok=!!meta && meta.name===label &&
          meta.mimeType==='application/vnd.google-apps.folder' &&
          meta.trashed!==true;
      }catch(e){ /* 読み取り不能 */ }
      add('folder-'+name,ok,'受け渡しフォルダ「'+(name==='root'?'本体':name)+'」の存在');
    }
  }
  const futureRow=Number(val('OSH_LEGACY_AUTO_START_ROW'));
  const responseLastRow = response && typeof response.getLastRow === 'function'
    ? response.getLastRow() : null;
  // 接続前にフォームに既に存在する行を自動取込対象へ含めない。
  // この診断は新機能がOFFの状態で実施することを前提とする。
  add('new-rows-only',!!val('OSH_LEGACY_AUTO_START_ROW')&&
    Number.isInteger(futureRow)&&futureRow>=2&&
    Number.isInteger(responseLastRow)&&futureRow>responseLastRow,
    '自動取込の開始行が、現在のフォーム回答の最終行より後にある','warning');
  const startMs=Date.parse(val('OSH_LEGACY_AI_START_AFTER'));
  add('new-files-only',Number.isFinite(startMs),
    'AIが扱うファイルの開始日時を指定している（過去の案件は処理しない）','warning');
  add('ai-model',!!val('ANTHROPIC_MODEL'),'AIモデルの設定がある','warning');
  add('ai-secret',!!val('ANTHROPIC_API_KEY'),'AI接続情報がある（値は表示しない）','warning');
  // 本番への許可は診断がすべてOKになっても常にfalse。接続・課金・公開は別途承認。
  return {
    mode:'read-only',readyForReview:checks.every(x=>x.ok),
    productionApproved:false,
    items:checks
  };
}

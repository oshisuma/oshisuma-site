/**
 * オシスマ自動化：安全な接続前チェック（読取専用）
 * 既存の Apps Script に統合後、オーナー本人が管理画面から実行することを想定。
 * 権限・スイッチ・フォーム/管理シート/フォルダ構造を確認。
 * 設定値（メールアドレス/ID/URL/APIキー）は絶対に返さない。
 *
 * 非実行：外部AI API、メール送信、Driveへの書込み、スプレッドシートへの書込み、
 * 本番公開、トリガー作成、GitHubへの送信。
 */
const OSH_PREFLIGHT = {
  hold: ['R-20261117-f5586927','R-20261117-83fc7631'],
  sheetTitles: {
    form:'フォームの回答 1', management:'下書き', imported:'取り込み済み'
  },
  headers: {
    form:['タイムスタンプ','担当スタッフ','お客様来店地域','その他の地域名（その他を選んだ場合のみ）',
      '機種・サービス名','今日の対応内容','写真'],
    draft:['報告ID','版','HP','Google','報告データ（JSON）','更新日時'],
    imported:['報告キー','報告ID','回答の行','報告日時','取り込み日時','担当スタッフ（非公開）']
  }
};
function oshPreflightRow_(key, ok, description, severity='error') {
  return {key,ok:!!ok,description,severity:ok?'ok':severity};
}
function oshPreflightActiveUser_(p) {
  const allowed=String(p.getProperty('PREVIEW_OWNER_EMAIL')||'').trim().toLowerCase();
  const active=String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();
  return !!allowed && !!active && allowed===active;
}
function oshPreflightHeaders_(sheet,expected) {
  if (!sheet)return false;
  const got=sheet.getRange(1,1,1,expected.length).getValues()[0].map(x=>String(x).trim());
  return got.length===expected.length && expected.every((v,i)=>got[i]===v);
}
/**
 * GAS の本番スクリプトから直接実行するだけでは不十分。
 * 本人限定の既存管理画面から呼び出すときも、同一の本人認証が必須。
 */
function oshAutoPreflight() {
  const p=PropertiesService.getScriptProperties();
  if (!oshPreflightActiveUser_(p))
    throw new Error('本人確認できないため接続確認を停止しました');
  const v=key=>String(p.getProperty(key)||'').trim();
  const results=[];
  const has=key=>v(key).length>0;
  const check=(key,ok,desc,severity='error')=>
    results.push(oshPreflightRow_(key,ok,desc,severity));
  const switches=['AUTO_INTAKE_ENABLED','AUTO_DRAFT_ENABLED',
    'AUTO_DRAFT_SHEET_SYNC_ENABLED','PREVIEW_OWNER_ENABLED'];
  const switchesOff=switches.every(k=>v(k)!=='true');
  check('test-mode',switchesOff,'自動取込・AI生成・同期・所有者プレビューは、導入前はOFFが必須');
  check('handoff-folder',has('HANDOFF_FOLDER_ID'),'受け渡し用フォルダIDの設定');
  check('form-sheet',has('SOURCE_SPREADSHEET_ID'),'フォーム回答シートの設定');
  check('management-sheet',has('MANAGEMENT_SPREADSHEET_ID'),'管理シートの設定');
  const start=Date.parse(v('AUTO_START_AFTER'));
  check('safe-start',Number.isFinite(start),'導入開始日時が設定済み');
  const min=Number(v('AUTO_INTAKE_MIN_ROW'));
  check('start-row',has('AUTO_INTAKE_MIN_ROW') && Number.isInteger(min) && min>=2,
    '自動取込を開始する回答行が設定済み');
  const holds=new Set(v('HOLD_REPORT_IDS').split(',').map(x=>x.trim()).filter(Boolean));
  check('hold-reports',OSH_PREFLIGHT.hold.every(id=>holds.has(id)),
    '保留中のGalaxy・iPadを対象外にする設定');
  check('ai-consent',v('AI_DATA_SHARING_APPROVED')==='false' ||
    v('AI_DATA_SHARING_APPROVED')==='','外部AI送信の承認前は送信禁止');
  check('api-secret',has('ANTHROPIC_API_KEY'),'APIキー設定の有無（値は非表示）','warning');
  check('api-model',has('ANTHROPIC_MODEL'),'AIモデル設定の有無','warning');
  check('notify',has('OWNER_EMAIL') && /^https:\/\//.test(v('APPROVAL_URL')),
    '通知先・HTTPSの管理画面URLの設定');
  let form=null,mgmt=null;
  if(has('SOURCE_SPREADSHEET_ID')) {
    try {
      form=SpreadsheetApp.openById(v('SOURCE_SPREADSHEET_ID'))
        .getSheetByName(OSH_PREFLIGHT.sheetTitles.form);
      check('form-headers',oshPreflightHeaders_(form,OSH_PREFLIGHT.headers.form),
        'フォーム回答シートの列構成');
    }catch(_){check('form-headers',false,'フォーム回答シートの列構成・アクセス');}
  }
  if(has('MANAGEMENT_SPREADSHEET_ID')) {
    try {
      const book=SpreadsheetApp.openById(v('MANAGEMENT_SPREADSHEET_ID'));
      mgmt=book.getSheetByName(OSH_PREFLIGHT.sheetTitles.management);
      const imported=book.getSheetByName(OSH_PREFLIGHT.sheetTitles.imported);
      check('draft-headers',oshPreflightHeaders_(mgmt,OSH_PREFLIGHT.headers.draft),
        '管理シート「下書き」の列構成');
      check('import-headers',oshPreflightHeaders_(imported,OSH_PREFLIGHT.headers.imported),
        '管理シート「取り込み済み」の列構成');
    }catch(_){
      check('draft-headers',false,'管理シート「下書き」の列構成・アクセス');
      check('import-headers',false,'管理シート「取り込み済み」の列構成・アクセス');
    }
  }
  if(has('HANDOFF_FOLDER_ID')) {
    try {
      const root=DriveApp.getFolderById(v('HANDOFF_FOLDER_ID'));
      for(const name of ['intake','drafts','photos']){
        check('folder-'+name,root.getFoldersByName(name).hasNext(),
          '受け渡し用 '+name+' フォルダが存在');
      }
    }catch(_){
      for(const name of ['intake','drafts','photos'])
        check('folder-'+name,false,'受け渡し用 '+name+' フォルダのアクセス');
    }
  }
  // 安全のため warning も含め「pass」に数えない。ユーザーへの使用許可は別途必要。
  const ready=results.every(r=>r.ok);
  return {
    mode:'read-only',readyToReview:ready,productionAuthorized:false,
    checkedAt:Utilities.formatDate(new Date(),'Asia/Tokyo','yyyy-MM-dd HH:mm'),
    results
  };
}

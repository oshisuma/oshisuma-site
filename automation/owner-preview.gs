/**
 * 既存のGoogle Apps Script承認画面に統合する「読取専用プレビュー」サーバー部品。
 * 注意: 本番未接続。doGetやデプロイ関数を追加しない。
 *
 * PREVIEW_OWNER_ENABLED=true と PREVIEW_OWNER_EMAIL を設定後のみ読取可能。
 * 必ず Session.getActiveUser().getEmail() でログイン本人を確認。
 * 「自分として実行する」Webアプリで閲覧者メールが取得不能な場合は拒否。
 * owner-preview.html 側から google.script.run.oshPreviewOwnerView(reportId) で呼ぶ。
 */
function oshPreviewRequireOwner_() {
  const p=PropertiesService.getScriptProperties();
  if (p.getProperty('PREVIEW_OWNER_ENABLED')!=='true')
    throw new Error('下書きプレビューは無効です');
  const allowed=String(p.getProperty('PREVIEW_OWNER_EMAIL')||'').trim().toLowerCase();
  const signedIn=String(Session.getActiveUser().getEmail()||'').trim().toLowerCase();
  // active email が空でも effective user にはフォールバックしない。
  if (!allowed || !signedIn || signedIn!==allowed)
    throw new Error('プレビューの閲覧権限が確認できません');
  return p;
}
function oshPreviewEscapeValue_(v,max) {
  return String(v==null?'':v).slice(0,max);
}
function oshPreviewCheckId_(id) {
  if (!/^R-\d{8}-[a-z0-9]{8}$/i.test(id||''))throw new Error('報告IDが不正です');
}
function oshPreviewModel_(r,revision,held) {
  if (!r || r.status!=='draft' || r.approval?.hp?.state!=='draft' ||
      r.approval?.gbp?.state!=='draft' || r.publishLog?.hp || r.publishLog?.gbp)
    throw new Error('未承認の下書きではありません');
  const model={
    reportId:oshPreviewEscapeValue_(r.reportId,30),revision:Number(revision)||1,
    device:oshPreviewEscapeValue_(r.facts?.device?.name,160),
    area:oshPreviewEscapeValue_(r.facts?.area?.name,160),
    stage: held?'hold':oshPreviewEscapeValue_(r.workflow?.stage||'needs-review',40),
    hp:null,gbp:null,photos:[],canApprove:false
  };
  const hp=r.drafts?.hp,gbp=r.drafts?.gbp;
  if(hp) {
    const sections=Array.isArray(hp.sections)?hp.sections:[];
    model.hp={
      title:oshPreviewEscapeValue_(hp.titleDevice||model.device,160),
      titleServices:(Array.isArray(hp.titleServices)?hp.titleServices:[])
        .slice(0,8).map(x=>oshPreviewEscapeValue_(x,100)),
      description:oshPreviewEscapeValue_(hp.description,2500),
      sections:sections.slice(0,12).map(s=>({
        heading:oshPreviewEscapeValue_(s.heading,160),
        paragraphs:(Array.isArray(s.paragraphs)?s.paragraphs:[]).slice(0,20)
          .map(v=>oshPreviewEscapeValue_(typeof v==='string'?v:v?.text,3000))
      }))
    };
  }
  if(gbp)model.gbp=oshPreviewEscapeValue_(gbp.summary,5000);
  const media=Array.isArray(r.media)?r.media:[];
  model.photos=media.slice(0,5).map(m=>({
    id:oshPreviewEscapeValue_(m.id,5),
    alt:oshPreviewEscapeValue_(m.alt,300),
    // 未検査の写真を権限なしのURLやdataURIで返さない。写真用の安全な専用プロキシが接続されるまで画像そのものは返さない。
    state:m.privacyCheck==='ok'&&m.contentMatch==='ok'?'reviewed':'pending'
  }));
  if(!model.device)throw new Error('機種が未入力です');
  return model;
}
/**
 * オーナーだけが閲覧できる下書き一覧。
 * 個人情報、スタッフ報告、元写真ID、記事本文、承認トークンは返さない。
 * 「報告ID入力」を不要にするための読取専用API（GAS本番へは未接続）。
 */
function oshPreviewOwnerPending() {
  const p=oshPreviewRequireOwner_();
  const sheetId=p.getProperty('MANAGEMENT_SPREADSHEET_ID');
  if(!sheetId)throw new Error('管理シートの設定がありません');
  const sheet=SpreadsheetApp.openById(sheetId).getSheetByName('下書き');
  if(!sheet)throw new Error('管理シート「下書き」が見つかりません');
  const last=sheet.getLastRow();
  if(last>5001)throw new Error('行数が多いため安全停止。検索方式の変更が必要です');
  const hdr=sheet.getRange(1,1,1,6).getValues()[0].map(String);
  if(JSON.stringify(hdr)!==JSON.stringify(['報告ID','版','HP','Google','報告データ（JSON）','更新日時']))
    throw new Error('管理シートの形式が違います');
  if(last<=1)return [];
  const rows=sheet.getRange(2,1,last-1,5).getValues();
  const held=new Set(String(p.getProperty('HOLD_REPORT_IDS')||'').split(',')
    .map(x=>x.trim()).filter(Boolean));
  const seen=new Set();
  const out=[];
  // 先に新着を表示。50件までに絞り、操作できる状態は返さない。
  for(let i=rows.length-1;i>=0 && out.length<50;i--){
    const row=rows[i];
    const id=String(row[0]||'');
    if(!/^R-\d{8}-[a-z0-9]{8}$/i.test(id) || seen.has(id))continue;
    seen.add(id);
    if(row[2]!=='draft' || row[3]!=='draft')continue;
    let draft;
    try{draft=JSON.parse(String(row[4]||'{}'));}catch(_){continue;}
    if(!draft || draft.reportId!==id || draft.status!=='draft' ||
       draft.approval?.hp?.state!=='draft' || draft.approval?.gbp?.state!=='draft' ||
       draft.publishLog?.hp || draft.publishLog?.gbp)continue;
    const device=oshPreviewEscapeValue_(draft.facts?.device?.name,160);
    if(!device)continue;
    out.push({
      reportId:id,
      device,
      area:oshPreviewEscapeValue_(draft.facts?.area?.name,160),
      stage:held.has(id)?'hold':oshPreviewEscapeValue_(draft.workflow?.stage||'needs-review',40),
      revision:Number(row[1])||1,
      canApprove:false
    });
  }
  return out;
}

/** owner専用。Sheetは読取のみ。外部AI、Drive書込、公開、メール送信を行わない。 */
function oshPreviewOwnerView(reportId) {
  const p=oshPreviewRequireOwner_();
  oshPreviewCheckId_(reportId);
  const sheetId=p.getProperty('MANAGEMENT_SPREADSHEET_ID');
  if (!sheetId)throw new Error('管理シートの設定がありません');
  const sheet=SpreadsheetApp.openById(sheetId).getSheetByName('下書き');
  if(!sheet)throw new Error('管理シート「下書き」が見つかりません');
  const last=sheet.getLastRow();
  if(last>5001)throw new Error('行数が多いため安全停止。検索方式の変更が必要です');
  const hdr=sheet.getRange(1,1,1,6).getValues()[0].map(String);
  if(JSON.stringify(hdr)!==JSON.stringify(['報告ID','版','HP','Google','報告データ（JSON）','更新日時']))
    throw new Error('管理シートの形式が違います');
  if(last<=1)throw new Error('該当する下書きがありません');
  const rows=sheet.getRange(2,1,last-1,5).getValues();
  const matched=rows.filter(row=>String(row[0])===reportId);
  if(matched.length!==1)throw new Error('下書きが存在しないか重複しています');
  const row=matched[0];
  if(row[2]!=='draft'||row[3]!=='draft')throw new Error('未承認の下書きではありません');
  const data=JSON.parse(String(row[4]||'{}'));
  if(data.reportId!==reportId)throw new Error('データと報告IDが一致しません');
  const held=String(p.getProperty('HOLD_REPORT_IDS')||'').split(',').map(x=>x.trim()).includes(reportId);
  return oshPreviewModel_(data,row[1],held);
}

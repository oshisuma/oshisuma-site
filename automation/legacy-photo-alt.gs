/**
 * オシスマ本番の既存承認.gs向け：写真説明文（alt）の本人入力ブリッジ。
 * 【本番未導入／未実行】既存 withDraft_ の権限確認・報告版照合・ロックを使用。
 * 既存の写真・報告文・公開済み記事・元ファイルを書き換えない。
 *
 * お客様の顔/名前/住所/QRコード等を含まないとオーナーが写真を目視確認して
 * 「公開OK」を押した後にのみ、事実に即したaltを手動保存できる。
 * 自動で写真を「公開OK」にしたりAIからの説明を無検証保存したりしない。
 */
function oshLegacyPhotoAltCheck_(value) {
  if(typeof value!=='string')throw new Error('写真の説明文を入力してください');
  const alt=value.normalize('NFKC').replace(/\s+/g,' ').trim();
  if(alt.length<8||alt.length>180)
    throw new Error('写真の説明文は8〜180文字にしてください');
  if(/[\u0000-\u001f\u007f]/.test(alt))
    throw new Error('写真の説明文に不正な文字があります');
  // 公開用文章に明白な連絡先/住所/リンク/識別番号を混ぜない。
  // 人名や顔の有無は自動判定できないため、写真の本人目視確認は必須。
  if(/https?:\/\/|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(alt)||
     /(?:\+81[-\s]?)?0\d{1,4}[-‐－ー\s]?\d{1,4}[-‐－ー\s]?\d{3,4}/.test(alt)||
     /〒|\d{3}[-‐－ー]\d{4}|丁目|番地|[A-HJ-NPR-Z0-9]{15,17}/i.test(alt))
    throw new Error('写真の説明文に個人情報らしき記載があります。公開用に書き直してください');
  return alt;
}
/**
 * 既存 viewModel_ の photos[].alt を更新する。
 * m.privacyCheck と m.contentMatch はオーナーの既存 apiPhoto 決定だけで変更する。
 */
function oshLegacySetPhotoAlt(reportId,mediaId,alt,revision) {
  if(!/^R-\d{8}-[a-z0-9]{8}$/i.test(reportId||''))
    throw new Error('報告IDの形式が正しくありません');
  if(!/^p[1-5]$/.test(mediaId||''))
    throw new Error('写真IDの形式が正しくありません');
  const checked=oshLegacyPhotoAltCheck_(alt);
  // 本番承認.gsが持つ本人認証/排他制御/版確認をそのまま再利用。
  return withDraft_(reportId,revision,function(d,user){
    const r=d.report;
    if(!r.drafts?.hp||!r.drafts?.gbp)
      throw new Error('下書きの本文ができるまでは説明文を確定できません');
    if(['hp','gbp','gbpPhotos'].some(ch=>approvalOf_(r,ch).state==='published'))
      throw new Error('公開済みの案件は、この操作で変更できません');
    const photo=(r.media||[]).filter(x=>x.id===mediaId)[0];
    if(!photo)throw new Error('対象の写真がありません');
    if(photo.privacyCheck!=='ok'||photo.contentMatch!=='ok')
      throw new Error('先に写真を目視確認し「公開OK」にしてください');
    if(photo.alt===checked)return; // 変更がなければログと承認取消しを発生させない。
    photo.alt=checked;
    // 変更済みの承認印を再利用しない。媒体の指紋と内容を再確認してから再承認。
    ['hp','gbp','gbpPhotos'].forEach(function(ch){
      if(approvalOf_(r,ch).state==='approved'){
        r.approval[ch]={state:'draft',by:user,at:now_(),revision:d.revision,
          note:'写真の説明文が変更されたため、再承認が必要です。'};
      }
    });
    // 既存 withDraft_ は版を自動加算しない。apiEdit と同じく、
    // 編集内容が変わった場合にここで1だけ増やして古い画面からの上書きを拒否する。
    d.revision += 1;
    log_(user,r.reportId,'photo','写真の説明文を保存',mediaId+'・版'+d.revision);
  });
}

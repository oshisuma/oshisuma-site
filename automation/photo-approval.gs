/**
 * 写真加工の承認指紋を生成するGAS版。
 * tools/cases/photo-approval.mjs と同じJSON配列構造・SHA-256先頭16バイトのhex。
 * 既存の承認画面への統合はまだ行っていない。
 *
 * 重要：
 * - この関数があるだけで写真加工を承認したことにはならない。
 * - 既存のオーナー本人確認・承認履歴・改版番号を維持して呼び出すこと。
 * - 元の報告のクロップ・マスク・補正を「プレビュー確認→承認」した後のみ
 *   approval.photoTransform = {state:'approved', fp:oshPhotoFingerprint_(report),...} を付ける。
 * - 設定を変更したら写真加工の承認を取り消す。
 */
function oshPhotoRect_(object, label) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    throw new Error(label + 'の形式が不正です');
  }
  const vals = ['x','y','w','h'].map(k => object[k]);
  if (!vals.every(n => typeof n === 'number' && Number.isFinite(n)) ||
      vals[0] < 0 || vals[1] < 0 || vals[2] <= 0 || vals[3] <= 0 ||
      vals[0] + vals[2] > 1 || vals[1] + vals[3] > 1)
    throw new Error(label + 'の範囲が不正です');
  if (Object.keys(object).sort().join(',') !== 'h,w,x,y')
    throw new Error(label + 'に未対応の設定が含まれています');
  return vals;
}
function oshPhotoTone_(tone) {
  if (!tone || typeof tone !== 'object' || Array.isArray(tone))
    throw new Error('写真補正の形式が不正です');
  if (Object.keys(tone).sort().join(',') !== 'brightness,contrast,saturation')
    throw new Error('写真補正に未対応の設定が含まれています');
  const values = ['brightness','contrast','saturation'].map(k => tone[k]);
  if (!values.every(v => typeof v === 'number' && Number.isFinite(v)) ||
    values[0] < 0.9 || values[0] > 1.1 ||
    values[1] < 0.9 || values[1] > 1.1 ||
    values[2] < 0.92 || values[2] > 1.08)
    throw new Error('写真補正値が不正か強すぎます');
  return values;
}
function oshPhotoTransformData_(report) {
  if (!report || !/^[A-Za-z0-9-]+$/.test(report.reportId || '') ||
      !Array.isArray(report.media))
    throw new Error('写真加工の報告データが不正です');
  const media = report.media.map(m => {
    if (!m || !/^[a-zA-Z][a-zA-Z0-9_-]{0,20}$/.test(m.id || '') ||
        !String(m.original || m.src || '').trim())
      throw new Error('写真加工の元写真IDが不正です');
    const crop = m.crop == null ? null : oshPhotoRect_(m.crop, 'トリミング');
    const masks = m.privacyMasks == null ? [] :
      Array.isArray(m.privacyMasks) && m.privacyMasks.length <= 25
        ? m.privacyMasks.map(x => oshPhotoRect_(x, '個人情報マスク'))
        : (() => { throw new Error('個人情報マスクの数が不正です'); })();
    const tone = m.photoTone == null ? null : oshPhotoTone_(m.photoTone);
    return [m.id, m.original || m.src, crop, masks, tone];
  });
  return ['oshisma-photo-transform-v1',report.reportId,media];
}
function oshPhotoFingerprint_(report) {
  const data = JSON.stringify(oshPhotoTransformData_(report));
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, data, Utilities.Charset.UTF_8);
  return bytes.slice(0,16).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function oshPhotoEdits_(report) {
  return Array.isArray(report && report.media) && report.media.some(m =>
    m.crop != null || (m.privacyMasks != null && m.privacyMasks.length > 0) || m.photoTone != null);
}
function oshPhotoAssertApproved_(report, approval) {
  if (!oshPhotoEdits_(report)) return;
  const fp = oshPhotoFingerprint_(report);
  if (!approval || approval.state !== 'approved' ||
      !/^[a-f0-9]{32}$/.test(approval.fp || '') || approval.fp !== fp)
    throw new Error('写真の加工内容が未承認、または承認後に変更されています');
}

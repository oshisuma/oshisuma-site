// 写真のトリミング・保護マスク・品質補正を、公開承認後に変更できないようにする。
// 既存のHP記事・Google投稿の指紋は変更せず、写真加工専用の追加承認を求める。
// Google Apps Script側にも同じ形式で計算する実装が入るまでは新しい写真加工は本番に使えない。
import { createHash } from 'node:crypto';

function rectangle(obj, label) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj))
    throw new Error(label + 'の形式が不正です');
  const vals = ['x', 'y', 'w', 'h'].map(k => obj[k]);
  if (!vals.every(n => typeof n === 'number' && Number.isFinite(n)) ||
      vals[0] < 0 || vals[1] < 0 || vals[2] <= 0 || vals[3] <= 0 ||
      vals[0] + vals[2] > 1 || vals[1] + vals[3] > 1)
    throw new Error(label + 'の範囲が不正です');
  if (Object.keys(obj).sort().join(',') !== 'h,w,x,y')
    throw new Error(label + 'に未対応の設定が含まれています');
  return [vals[0], vals[1], vals[2], vals[3]];
}

function toneValues(tone) {
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

export function photoTransformData(report) {
  if (!report || !/^[A-Za-z0-9-]+$/.test(report.reportId || '') ||
      !Array.isArray(report.media))
    throw new Error('写真加工の報告データが不正です');
  const media = report.media.map(m => {
    if (!m || !/^[a-zA-Z][a-zA-Z0-9_-]{0,20}$/.test(m.id || '') ||
        !String(m.original || m.src || '').trim())
      throw new Error('写真加工の元写真IDが不正です');
    const crop = m.crop == null ? null : rectangle(m.crop, 'トリミング');
    const masks = m.privacyMasks == null ? [] :
      Array.isArray(m.privacyMasks) && m.privacyMasks.length <= 25
        ? m.privacyMasks.map(x => rectangle(x, '個人情報マスク'))
        : (() => { throw new Error('個人情報マスクの数が不正です'); })();
    const tone = m.photoTone == null ? null : toneValues(m.photoTone);
    return [m.id, m.original || m.src, crop, masks, tone];
  });
  return ['oshisma-photo-transform-v1',report.reportId,media];
}

export function hasPhotoEdits(report) {
  return Array.isArray(report?.media) && report.media.some(m =>
    m.crop != null || (m.privacyMasks != null && m.privacyMasks.length > 0) ||
    m.photoTone != null
  );
}

export function photoTransformFingerprint(report) {
  return createHash('sha256').update(JSON.stringify(photoTransformData(report)), 'utf8')
    .digest('hex').slice(0,32);
}

export function assertPhotoTransformApproved(report, approval) {
  // 単なるExif除去・サイズ縮小は従来どおりの処理。新しい編集項目だけ追加承認の対象。
  if (!hasPhotoEdits(report)) return;
  const fp = photoTransformFingerprint(report);
  if (!approval || approval.state !== 'approved' ||
      !/^[a-f0-9]{32}$/.test(approval.fp || '') ||
      approval.fp !== fp)
    throw new Error('写真の加工内容（ぼかし・塗りつぶし・補正・切り抜き）が承認されていません。写真を確認し、再承認してください。');
}

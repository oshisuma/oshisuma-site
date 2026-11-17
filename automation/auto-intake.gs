/**
 * 修理事例 自動取り込み（未導入・既定OFF）
 * スプレッドシートの既存回答を読み、まだ取り込んでいない行だけを
 * 既存の受け渡し用フォルダ intake / photos に書き出す。
 * 既存の「取り込み済み」へは正常保存の後に1行だけ追記。
 * 既存のGAS実装と相互に重複する可能性があるため、統合時に名前とロックを照合する。
 *
 * Properties: AUTO_INTAKE_ENABLED, SOURCE_SPREADSHEET_ID, MANAGEMENT_SPREADSHEET_ID,
 * HANDOFF_FOLDER_ID, AUTO_INTAKE_MIN_ROW, HOLD_REPORT_IDS
 */
const OSH_INTAKE = {
  sourceTab: 'フォームの回答 1', importedTab: '取り込み済み',
  handoff: 'intake', photos: 'photos',
  columns: ['タイムスタンプ', '担当スタッフ', 'お客様来店地域',
    'その他の地域名（その他を選んだ場合のみ）', '機種・サービス名', '今日の対応内容', '写真']
};
function oshIntakeConfig_() {
  const p = PropertiesService.getScriptProperties();
  return {
    enabled: p.getProperty('AUTO_INTAKE_ENABLED') === 'true',
    sourceId: p.getProperty('SOURCE_SPREADSHEET_ID'),
    managementId: p.getProperty('MANAGEMENT_SPREADSHEET_ID'),
    handoffId: p.getProperty('HANDOFF_FOLDER_ID'),
    minRow: Number(p.getProperty('AUTO_INTAKE_MIN_ROW') || '999999'),
    hold: String(p.getProperty('HOLD_REPORT_IDS') || '').split(',').map(s => s.trim()).filter(Boolean)
  };
}
function oshIntakeValidateHeader_(headers) {
  return OSH_INTAKE.columns.every((h, i) => String(headers[i] || '').trim() === h);
}
function oshIntakeFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (!it.hasNext()) throw new Error('既存フォルダが見つかりません: ' + name);
  return it.next();
}
function oshIntakeFind_(folder, name) {
  const it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}
function oshIntakeSlug_(name) {
  return String(name || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function oshIntakeArea_(name) {
  const known = {
    '茨城町':'ibaraki','水戸市':'mito','大洗町':'oarai',
    '鉾田市':'hokota','笠間市':'kasama','小美玉市':'omitama',
    '茨城県内':'ibaraki-pref','その他':'other','不明':'unknown'
  };
  return known[name] || 'unknown';
}
function oshIntakePhotos_(cell) {
  const urls = String(cell || '').match(/(?:https?:\/\/[^\s,，]+|[\w-]{25,})/g) || [];
  const ids = urls.map(s => {
    const m = s.match(/(?:[?&]id=|\/d\/)([a-zA-Z0-9_-]{15,})/);
    return m ? m[1] : (/^[\w-]{25,}$/.test(s) ? s : '');
  }).filter(Boolean);
  return Array.from(new Set(ids)).slice(0, 5);
}
function oshIntakeDate_(raw) {
  if (raw instanceof Date) return new Date(raw.getTime());
  const match = String(raw || '').trim().match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return new Date(NaN);
  const [, year, month, day, hour, minute, second='0'] = match;
  return new Date(year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0') +
    'T' + hour.padStart(2, '0') + ':' + minute + ':' + second.padStart(2, '0') + '+09:00');
}
function oshIntakeStableId_(row, timestamp, device) {
  // ランダム生成ではなく、シート行番号＋日時＋機種に固定して再実行時の重複を防ぐ
  const seed = String(row) + ':' + String(timestamp) + ':' + String(device);
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed, Utilities.Charset.UTF_8);
  const hex = bytes.slice(0, 4).map(x => ('0' + (x & 255).toString(16)).slice(-2)).join('');
  const date = Utilities.formatDate(new Date(timestamp), 'Asia/Tokyo', 'yyyyMMdd');
  return 'R-' + date + '-' + hex;
}
function oshIntakeMapRow_(values, rowNumber) {
  const [rawTimestamp, staff, rawArea, otherArea, device, body, imageCell] = values;
  const timestamp = oshIntakeDate_(rawTimestamp);
  if (!Number.isFinite(timestamp.getTime())) return null;
  if (!String(device || '').trim() || !String(body || '').trim()) return null;
  const imageIds = oshIntakePhotos_(imageCell);
  // 写真が指定されているのにURL形式を解釈できない場合は黙って無視しない
  if (!String(imageCell || '').trim() || imageIds.length === 0)
    throw new Error('回答' + rowNumber + 'の写真がありません。公開用の自動取り込みを停止');
  if (imageIds.length > 5) throw new Error('回答' + rowNumber + 'の写真が5枚を超えています');
  const area = String(rawArea || '不明').trim();
  const id = oshIntakeStableId_(rowNumber, timestamp.toISOString(), device);
  const sourceKey = 'auto_row_' + rowNumber + '_' + id.split('-').pop();
  return {
    staff: String(staff || '').trim(), sourceKey,
    rowNumber, timestamp,
    report: {
      schemaVersion: 1, reportId: id, status: 'needs-draft',
      source: { type: 'google-form', key: sourceKey, mode: 'production' },
      facts: {
        workDate: Utilities.formatDate(timestamp, 'Asia/Tokyo', 'yyyy-MM-dd'),
        area: { name: area === 'その他' && otherArea ? String(otherArea).trim() : area, slug: oshIntakeArea_(area) },
        device: { category: 'other', name: String(device).trim(), slug: oshIntakeSlug_(device) || 'unknown' },
        consultation: '', works: [], result: '', staffComment: '',
        uncertain: ['作業日は回答日時から仮置き。実際の作業日は未確認のため本文で断定しない']
      },
      intake: { reportText: String(body), originalsRef: 'drive' },
      media: imageIds.map((fid, i) => ({ id: 'p' + (i + 1), original: 'drive:' + fid,
        privacyCheck: 'pending', contentMatch: 'pending', alt: '', caption: '' })),
      drafts: { hp: null, gbp: null }, publishLog: { hp: null, gbp: null },
      approval: { hp: { state: 'draft' }, gbp: { state: 'draft' }, returns: [] }
    }
  };
}
/** 手動取り込み済みの回答行は絶対に再処理しない。写真コピー失敗なら記録を追記しない。 */
function oshAutoIntakeTick() {
  const c = oshIntakeConfig_();
  if (!c.enabled) return;
  if (!c.sourceId || !c.managementId || !c.handoffId ||
      !Number.isInteger(c.minRow) || c.minRow < 2)
    throw new Error('取り込み接続設定が不正。処理を停止');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const form = SpreadsheetApp.openById(c.sourceId).getSheetByName(OSH_INTAKE.sourceTab);
    const imported = SpreadsheetApp.openById(c.managementId).getSheetByName(OSH_INTAKE.importedTab);
    if (!form || !imported) throw new Error('シートが見つかりません');
    if (!oshIntakeValidateHeader_(form.getRange(1, 1, 1, 7).getValues()[0]))
      throw new Error('フォームの列名が変わったため停止');
    const importedRows = imported.getLastRow() > 1 ?
      imported.getRange(2, 1, imported.getLastRow()-1, 6).getValues() : [];
    const processed = new Set(importedRows.map(r => Number(r[2])).filter(Number.isInteger));
    const root = DriveApp.getFolderById(c.handoffId);
    const intake = oshIntakeFolder_(root, OSH_INTAKE.handoff);
    const photos = oshIntakeFolder_(root, OSH_INTAKE.photos);
    const end = form.getLastRow();
    let count = 0;
    for (let row = c.minRow; row <= end && count < 3; row++) {
      if (processed.has(row)) continue;
      const mapped = oshIntakeMapRow_(form.getRange(row, 1, 1, 7).getValues()[0], row);
      if (!mapped) continue;
      const report = mapped.report, name = report.reportId + '.json';
      if (c.hold.includes(report.reportId)) continue;
      // 既に同名ファイルがある場合は作らない（手動処理との競合防止）
      const prior = oshIntakeFind_(intake, name);
      if (prior) {
        // JSON作成後・履歴更新前の障害から復帰する場合も二重生成を避ける。
        const saved = JSON.parse(prior.getBlob().getDataAsString('utf-8'));
        if (saved.reportId !== report.reportId || saved.source?.key !== mapped.sourceKey)
          throw new Error('既存ファイルと入力行が一致しません: ' + name);
        imported.appendRow([mapped.sourceKey, report.reportId, row, mapped.timestamp.toISOString(),
          new Date().toISOString(), mapped.staff]);
        processed.add(row);
        count++;
        continue;
      }
      const folderName = report.reportId;
      let photoFolder = oshIntakeFolderOrCreate_(photos, folderName);
      let good = true;
      for (const media of report.media) {
        const fid = media.original.slice(6);
        const original = DriveApp.getFileById(fid);
        if (!original.getMimeType().startsWith('image/')) { good = false; break; }
        const ext = oshIntakeImageExt_(original.getMimeType());
        if (!ext) { good = false; break; }
        const filename = media.id + '.' + ext;
        if (!oshIntakeFind_(photoFolder, filename))
          original.makeCopy(filename, photoFolder);
      }
      if (!good) throw new Error('写真形式が非対応。回答行: ' + row);
      // 完全保存した後で記録。再試行時は元データを上書きしない。
      intake.createFile(name, JSON.stringify(report, null, 2), MimeType.PLAIN_TEXT);
      imported.appendRow([mapped.sourceKey, report.reportId, row, mapped.timestamp.toISOString(),
        new Date().toISOString(), mapped.staff]);
      processed.add(row);
      count++;
    }
  } finally { lock.releaseLock(); }
}
function oshIntakeFolderOrCreate_(root, name) {
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}
function oshIntakeImageExt_(mime) {
  const map = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp', 'image/heic':'heic' };
  return map[mime] || null;
}
/** 統合して接続設定を終えるまでは外から呼ばないこと。
 * 後半のAIにはAI_DATA_SHARING_APPROVEDなど独立した安全スイッチがある。
 */
function oshAutoIntakeAndDraftTick() {
  oshAutoIntakeTick();
  oshAutoTick();
}

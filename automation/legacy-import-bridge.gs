/**
 * 既存の本番「承認.gs」専用：フォーム取込の安全な自動化アダプター
 * 【本番未導入・既定OFF】既存のapiResponses()/apiImport()を使う。
 * 新しいID生成、元フォームへの書き込み、別方式での管理シート追記、
 * 別のDriveフォルダ生成は一切行わない。
 *
 * 既存の本人認証（requireApprover_）、重複排除（apiImportのimportedKeys_）、
 * 写真コピー（writeIntake_）、管理シート・操作ログへの記録をそのまま使う。
 *
 * GAS script properties:
 *   OSH_LEGACY_AUTO_IMPORT_ENABLED=false
 *   OSH_LEGACY_AUTO_START_ROW=（自動化開始後の新規回答行、必須）
 *   OSH_LEGACY_AUTO_HALTED=false
 *   OSH_LEGACY_AUTO_MAX_PER_TICK=2 (上限3)
 * 既存の会話中のGalaxy/iPad報告は過去の取り込み済み案件として対象外にする。
 *
 * 注意: apiResponses()は現行CONFIG.RECENT_RESPONSES件だけを返す。
 * 回答量が多いと古い未取込が残り得るため、実際の回答数・頻度を確認してから運用する。
 */
function oshLegacyAutoImportTick() {
  const p=PropertiesService.getScriptProperties();
  if(p.getProperty('OSH_LEGACY_AUTO_IMPORT_ENABLED')!=='true') {
    return {status:'disabled',imported:0};
  }
  if(p.getProperty('OSH_LEGACY_AUTO_HALTED')==='true') {
    throw new Error('前回の取込エラー後に停止しています。管理シートの状態確認が必要です');
  }
  if(typeof CONFIG==='undefined' || CONFIG.MODE!=='production' ||
    typeof requireApprover_!=='function' ||
    typeof apiResponses!=='function' || typeof apiImport!=='function') {
    throw new Error('本番の既存承認システムと接続できません');
  }
  // 時間トリガーで本人メールが取得できなければ失敗し、認証を迂回しない。
  requireApprover_();
  const start=Number(p.getProperty('OSH_LEGACY_AUTO_START_ROW'));
  if(!Number.isInteger(start) || start<2)
    throw new Error('自動取込を開始する回答行を設定してください');
  const configured=p.getProperty('OSH_LEGACY_AUTO_MAX_PER_TICK');
  const max=configured==null?2:Number(configured);
  if(!Number.isInteger(max) || max<1 || max>3)
    throw new Error('1回の最大取り込み件数が不正です');
  const response=apiResponses();
  if(!Array.isArray(response))throw new Error('既存の回答一覧が取得できません');
  const pending=response.filter(x=>
    x && Number.isInteger(x.row) && x.row>=start &&
    typeof x.key==='string' && x.key.length>0 &&
    !x.imported && Number.isInteger(x.photos) &&
    x.photos>0 && x.photos<=CONFIG.MAX_PHOTOS
  ).sort((a,b)=>a.row-b.row);
  const imported=[];
  for(const item of pending.slice(0,max)) {
    try{
      const result=apiImport(item.key); // 写真・ログ・管理シートは既存機能が一括管理
      if(!result || !/^R-\d{8}-[a-z0-9]{8}$/i.test(result.reportId||'')) {
        throw new Error('既存の取り込み処理の返却値が不正です');
      }
      imported.push(result.reportId);
    }catch(error){
      // apiImportは写真やフォルダを作った後に失敗することがある。
      // 自動再試行すると重複データができるため、明示的な再開までは停止。
      p.setProperty('OSH_LEGACY_AUTO_HALTED','true');
      Logger.log('自動取込を安全停止。確認が必要な回答行:'+item.row);
      throw new Error('自動取込を停止しました。取り込み済み・Drive・写真を確認してください');
    }
  }
  return {status:'checked',imported:imported.length,reportIds:imported};
}

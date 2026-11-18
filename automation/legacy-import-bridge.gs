/**
 * オシスマ：現行本番 apiImport() のみを使う新規回答の自動取り込み。
 * 【未導入・既定OFF】既存のフォーム回答シートは読むだけ。
 * apiResponses() の最新15件制限を回避するため、専用カーソルで新しい行を順番に見る。
 *
 * Script properties:
 *  OSH_LEGACY_AUTO_IMPORT_ENABLED=false
 *  OSH_LEGACY_AUTO_START_ROW=設置時点の最終行+1
 *  OSH_LEGACY_IMPORT_CURSOR=任意。未設定なら開始行
 *  OSH_LEGACY_AUTO_MAX_PER_TICK=2 （1〜3）
 *  OSH_LEGACY_AUTO_HALTED=false
 *
 * 既存の apiImport() が写真・管理シート・台帳の書込み、重複確認、本人認証を担当。
 * 読み取れない行や写真異常で止め、連続再試行しない。Google投稿・HP公開機能なし。
 */
function oshLegacyAutoImportTick() {
  const p=PropertiesService.getScriptProperties();
  if(p.getProperty('OSH_LEGACY_AUTO_IMPORT_ENABLED')!=='true')
    return {status:'disabled',imported:0};
  if(p.getProperty('OSH_LEGACY_AUTO_HALTED')==='true')
    throw new Error('前回の取込エラー後に停止しています。管理シートと写真フォルダを確認してください');
  if(typeof CONFIG==='undefined'||CONFIG.MODE!=='production'||
     typeof requireApprover_!=='function'||typeof apiImport!=='function'||
     typeof responseSheet_!=='function'||typeof getLayout_!=='function'||
     typeof readReport_!=='function'||typeof reportKey_!=='function'||
     typeof importedKeys_!=='function')
    throw new Error('既存の本番取り込み機能と接続できません');
  requireApprover_(); // 時間トリガーでも本人認証を省略しない
  const start=Number(p.getProperty('OSH_LEGACY_AUTO_START_ROW'));
  if(!Number.isInteger(start)||start<2)
    throw new Error('自動取込を開始する回答行を設定してください');
  const cursorRaw=p.getProperty('OSH_LEGACY_IMPORT_CURSOR');
  const cursor=cursorRaw==null||cursorRaw===''?start:Number(cursorRaw);
  if(!Number.isInteger(cursor)||cursor<start)
    throw new Error('自動取込カーソルが開始行より前になっています。処理を止めます');
  const configured=p.getProperty('OSH_LEGACY_AUTO_MAX_PER_TICK');
  const max=configured==null?2:Number(configured);
  if(!Number.isInteger(max)||max<1||max>3)
    throw new Error('1回の最大取り込み件数が不正です');
  const sh=responseSheet_(),last=sh.getLastRow();
  if(!Number.isInteger(last)||last<1||cursor>last+1)
    throw new Error('回答シートの行数が以前と合いません。手動確認が必要です');
  const layout=getLayout_(sh);
  const seen=importedKeys_();
  const imported=[];
  let current=cursor,scanned=0;
  while(current<=last && imported.length<max && scanned<50){
    const row=current; scanned++;
    let info;
    try {
      info=readReport_(sh,row,layout);
      if(!info || !info.timestampKey)
        throw new Error('報告日時のない回答がありました');
      if(!Array.isArray(info.photoIds)||info.photoIds.length<2||
          info.photoIds.length>CONFIG.MAX_PHOTOS)
        throw new Error('写真が2〜5枚の条件を満たしていません');
      const key=reportKey_(CONFIG.RESPONSE_SPREADSHEET_ID,info);
      if(typeof key!=='string'||!key.startsWith(CONFIG.KEY_PREFIX))
        throw new Error('報告キーを生成できません');
      if(!seen[key]){
        const result=apiImport(key);
        if(!result||!/^R-\d{8}-[a-z0-9]{8}$/i.test(result.reportId||''))
          throw new Error('既存の取り込み結果に問題があります');
        seen[key]=result.reportId;
        imported.push(result.reportId);
      }
      // 保存に成功した行、または既存台帳にある行だけ進める。
      current=row+1;
      p.setProperty('OSH_LEGACY_IMPORT_CURSOR',String(current));
    }catch(e){
      p.setProperty('OSH_LEGACY_AUTO_HALTED','true');
      Logger.log('自動取り込みを安全停止：回答行 '+row+' を確認してください');
      throw new Error('自動取込を停止しました。回答行 '+row+' と管理シート・写真を確認してください');
    }
  }
  return {status:current<=last?'more':'checked',imported:imported.length,
    reportIds:imported,nextRow:current};
}

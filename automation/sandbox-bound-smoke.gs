/**
 * オシスマ修理事例自動化：合成データ専用シートの読取診断（本番未導入）
 * 「オシスマ_修理事例自動化_合成テスト専用_20261118」
 * のGoogleスプレッドシートで [拡張機能] > [Apps Script] を開いて実行。
 *
 * 安全性：
 * - 本番管理シート、元Googleフォーム、Drive、外部AI、HPに一切アクセスしない。
 * - スプレッドシートを読み取るだけで、内容を書き込まない。
 * - シートのタイトルと合成テスト専用データが一致しなければ停止する。
 * - 権限確認やApps Scriptのプレビュー公開、時間トリガー作成は行わない。
 */
function oshSandboxReadOnlySmokeTest() {
  const expectedTitle='オシスマ_修理事例自動化_合成テスト専用_20261118';
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss || ss.getName()!==expectedTitle)
    throw new Error('合成テスト専用シートではありません。操作を中止しました');
  const expected={
    'フォームの回答 1':['タイムスタンプ','担当スタッフ','お客様来店地域',
      'その他の地域名（その他を選んだ場合のみ）','機種・サービス名','今日の対応内容','写真'],
    '下書き':['報告ID','版','HP','Google','報告データ（JSON）','更新日時'],
    '取り込み済み':['報告キー','報告ID','回答の行','報告日時','取り込み日時','担当スタッフ（非公開）'],
    '操作の記録':['日時','操作した人','報告ID','対象','操作','内容']
  };
  const result={mode:'read-only',passed:[],productionChanged:false,externalCalls:0};
  Object.keys(expected).forEach(function(name){
    const sh=ss.getSheetByName(name);
    if(!sh)throw new Error('テスト用タブがありません：'+name);
    const headers=sh.getRange(1,1,1,expected[name].length).getDisplayValues()[0];
    if(expected[name].some(function(x,i){return x!==headers[i];}))
      throw new Error('テスト用の見出しが変更されています：'+name);
    result.passed.push(name);
  });
  const answer=ss.getSheetByName('フォームの回答 1');
  if(answer.getLastRow()!==2)
    throw new Error('架空データの行数が予想と違います。追加された回答を確認してください');
  const record=answer.getRange(2,1,1,7).getDisplayValues()[0];
  if(record[1]!=='【合成テスト】スタッフ'||
     record[2]!=='水戸市'||record[4]!=='iPhone 15'||
     record[5].indexOf('【合成テスト専用】')!==0||
     record[6]!=='')
    throw new Error('テスト以外のデータがあるため停止しました');
  result.passed.push('合成データ1件と写真未添付の安全確認');
  Logger.log('合成テスト用シートの読み取りに成功：'+result.passed.length+'項目。外部送信・公開・変更なし');
  return result;
}

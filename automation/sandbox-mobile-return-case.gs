/**
 * オシスマ：別の架空記事によるスマホ差し戻し実機テスト
 *
 * 「確認済み」を記録済みのiPhone記事には一切触れない。
 * このファイルはテスト用GASにだけ追加する。
 * シート・HP・Google投稿・AI・メールには接続しない。
 * 操作結果は別キーの Script Properties に1回だけ保存する。
 */
const OSH_SANDBOX_RETURN_CASE_ = Object.freeze({
  reportId:'R-20261119-demo-return0001',
  sourceTag:'synthetic-return-v1@R-20261119-demo-return0001@1',
  revision:1,
  title:'小美玉市のiPad 第9世代 充電口修理事例（架空）',
  description:'【架空のテスト記事】充電できなくなったiPadのご相談を想定した例文です。実在のお客様や修理記録ではありません。',
  sections:[
    {heading:'ご相談',paragraphs:['充電ケーブルを差しても充電反応がありません。']},
    {heading:'修理内容',paragraphs:['充電口の部品を交換したという想定の文章です。']},
    {heading:'修理後',paragraphs:['動作確認が完了したという想定の文章です。']}
  ]
});
const OSH_SANDBOX_RETURN_KEY_='OSH_SANDBOX_MOBILE_RETURN_V1';

/** プレビューとテスト記録の本人限定読み取り。 */
function oshSandboxReturnRead(){
  const props=oshSandboxMobileOwner_();
  const raw=props.getProperty(OSH_SANDBOX_RETURN_KEY_);
  let saved=null;
  if(raw){
    if(raw.length>1800)throw new Error('差し戻しテスト記録が不正です');
    try{saved=JSON.parse(raw);}catch(_){throw new Error('差し戻しテスト記録が不正です');}
    if(!saved ||
       saved.type!=='osh-sandbox-return-v1' ||
       saved.reportId!==OSH_SANDBOX_RETURN_CASE_.reportId ||
       saved.sourceTag!==OSH_SANDBOX_RETURN_CASE_.sourceTag ||
       saved.sourceRevision!==1 ||
       saved.state!=='returned' ||
       typeof saved.reason!=='string' ||
       saved.reason.length<4 || saved.reason.length>300 ||
       !Number.isFinite(Date.parse(saved.at)) ||
       saved.testOnly!==true ||
       saved.canPublish!==false)
      throw new Error('差し戻しテスト記録が現在の記事と一致しません');
  }
  return {
    reportId:OSH_SANDBOX_RETURN_CASE_.reportId,
    sourceRevision:OSH_SANDBOX_RETURN_CASE_.revision,
    sourceTag:OSH_SANDBOX_RETURN_CASE_.sourceTag,
    title:OSH_SANDBOX_RETURN_CASE_.title,
    description:OSH_SANDBOX_RETURN_CASE_.description,
    sections:OSH_SANDBOX_RETURN_CASE_.sections,
    state:saved?'returned':'pending',
    reason:saved?saved.reason:'',
    recordedAt:saved?saved.at:'',
    testOnly:true,canPublish:false,photoCount:0
  };
}

/** 差し戻し専用。確認済みにする／公開する操作は存在しない。 */
function oshSandboxReturnSave(expectedTag,reason){
  if(typeof expectedTag!=='string' ||
     expectedTag!==OSH_SANDBOX_RETURN_CASE_.sourceTag)
    throw new Error('別の記事を操作できません');
  if(typeof reason!=='string' || reason.length>300)
    throw new Error('差し戻し理由は300文字以内で入力してください');
  const comment=reason.trim();
  if(comment.length<4)
    throw new Error('差し戻し理由は4文字以上入力してください');

  const lock=LockService.getScriptLock();
  if(!lock || !lock.tryLock(3000))throw new Error('別の操作中です。再読み込みしてください');
  try{
    const before=oshSandboxReturnRead(); // owner gate and existing record validation
    if(before.state!=='pending')
      throw new Error('差し戻し済みです。二重保存はできません');
    const saved={
      type:'osh-sandbox-return-v1',
      reportId:OSH_SANDBOX_RETURN_CASE_.reportId,
      sourceRevision:1,
      sourceTag:OSH_SANDBOX_RETURN_CASE_.sourceTag,
      state:'returned',reason:comment,at:new Date().toISOString(),
      testOnly:true,canPublish:false
    };
    oshSandboxMobileOwner_().setProperty(
      OSH_SANDBOX_RETURN_KEY_,JSON.stringify(saved)
    );
    return oshSandboxReturnRead();
  }finally{lock.releaseLock();}
}

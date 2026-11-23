/**
 * オシスマ：スマホ上の確認・差戻し操作【合成テスト専用】
 *
 * 「スマホ閲覧テスト.gs」にある本人限定のスナップショットを使う。
 * テスト結果は Script Properties のみに保存。Sheetsの承認列は変更しない。
 * 本番HP、Google投稿、メール、外部AI、Drive、顧客情報には接続しない。
 * このファイルは新しいスクリプトとしてテスト用GASのみに追加可能。
 */
const OSH_SANDBOX_MOBILE_ACTION_KEY_='OSH_SANDBOX_MOBILE_ACTION_V1';

/** スナップショットの出所、期限、本人認証を必ず再検証する。 */
function oshSandboxMobileActionContext_(){
  const view=oshSandboxMobileRead();
  const props=oshSandboxMobileOwner_();
  const raw=props.getProperty(OSH_SANDBOX_SNAPSHOT_KEY_);
  let snapshot;
  try{snapshot=JSON.parse(raw);}catch(_){throw new Error('架空記事の確認用データが不正です');}
  if(!snapshot ||
     snapshot.type!=='osh-sandbox-mobile-v1' ||
     snapshot.reportId!=='R-20261118-demo0001' ||
     snapshot.revision!==2 ||
     snapshot.review?.state!=='confirmed' ||
     snapshot.photoCount!==0 ||
     snapshot.canPublish!==false ||
     view.reportId!==snapshot.reportId ||
     view.revision!==snapshot.revision ||
     view.canPublish!==false)
    throw new Error('合成テスト用の記事ではありません');
  const tag=snapshot.revision+'@'+snapshot.createdAt;
  if(typeof tag!=='string' || tag.length>100)throw new Error('記事の版を確認できません');
  return {props,view,tag};
}

/** 保存済み結果を検証し、異なる記事や改版後の操作を拒否する。 */
function oshSandboxMobileActionStored_(props,tag){
  const raw=props.getProperty(OSH_SANDBOX_MOBILE_ACTION_KEY_);
  if(!raw)return null;
  if(raw.length>1800)throw new Error('テスト結果が不正です');
  let result;
  try{result=JSON.parse(raw);}catch(_){throw new Error('テスト結果を読み取れません');}
  if(!result ||
     result.type!=='osh-sandbox-mobile-action-v1' ||
     result.reportId!=='R-20261118-demo0001' ||
     result.sourceRevision!==2 ||
     result.sourceTag!==tag ||
     result.testOnly!==true ||
     result.canPublish!==false ||
     !['confirmed','returned'].includes(result.state) ||
     typeof result.reason!=='string' ||
     (result.state==='confirmed' && result.reason!=='') ||
     (result.state==='returned' && (result.reason.length<4 || result.reason.length>300)) ||
     !Number.isFinite(Date.parse(result.at)))
    throw new Error('テスト結果が現在の記事と一致しません');
  return result;
}

/** 画面表示用の状態。この記事は本番承認にも公開にも絶対に接続しない。 */
function oshSandboxMobileReviewState(){
  const ctx=oshSandboxMobileActionContext_();
  const saved=oshSandboxMobileActionStored_(ctx.props,ctx.tag);
  return {
    reportId:ctx.view.reportId,
    sourceRevision:ctx.view.revision,
    sourceTag:ctx.tag,
    state:saved?saved.state:'pending',
    reason:saved?saved.reason:'',
    recordedAt:saved?saved.at:'',
    testOnly:true,canPublish:false
  };
}

/**
 * スマホでの1回限りの動作確認をScript Propertiesに保存する。
 * 既存のシートの承認結果には一切手を加えない。
 */
function oshSandboxMobileReviewSave(action,expectedTag,reason){
  if(action!=='confirm' && action!=='return')
    throw new Error('対応していない操作です');
  if(typeof expectedTag!=='string' || expectedTag.length<12 || expectedTag.length>100)
    throw new Error('記事を再読み込みしてください');
  if(typeof reason!=='string' || reason.length>300)
    throw new Error('コメントは300文字以内にしてください');
  const comment=reason.trim();
  if(action==='return' && comment.length<4)
    throw new Error('差し戻しの理由を4文字以上入力してください');
  if(action==='confirm' && comment!=='')
    throw new Error('確認済みではコメントを付けられません');

  // 失敗時に保存しない。LockServiceはScript全体の同時操作を排除する。
  const lock=LockService.getScriptLock();
  if(!lock || !lock.tryLock(3000))throw new Error('別の操作中です。再度状態を確認してください');
  try{
    const ctx=oshSandboxMobileActionContext_();
    if(ctx.tag!==expectedTag)
      throw new Error('記事が更新されています。表示し直してください');
    if(oshSandboxMobileActionStored_(ctx.props,ctx.tag))
      throw new Error('すでにテスト結果が保存されています');

    const stored={
      type:'osh-sandbox-mobile-action-v1',
      reportId:ctx.view.reportId,
      sourceRevision:ctx.view.revision,
      sourceTag:ctx.tag,
      state:action==='confirm'?'confirmed':'returned',
      reason:comment,
      at:new Date().toISOString(),
      testOnly:true,canPublish:false
    };
    ctx.props.setProperty(OSH_SANDBOX_MOBILE_ACTION_KEY_,JSON.stringify(stored));
    return {
      reportId:ctx.view.reportId,
      sourceRevision:ctx.view.revision,
      sourceTag:ctx.tag,
      state:stored.state,
      reason:stored.reason,
      recordedAt:stored.at,
      testOnly:true,canPublish:false
    };
  }finally{
    lock.releaseLock();
  }
}

/**
 * オシスマ：承認画面で新着下書きを表示する部品（本番未導入）。
 * 専用の本人認証付き oshLegacyReviewInbox() を定期的に読むだけ。
 * apiList() は承認状態の自動整理時に管理シートを書き得るため使用しない。
 * 画面を閉じた後は通信しない。メールやプッシュ通知は行わない。
 */
const OSH_LEGACY_INBOX = {
  intervalMs: 90000, // 90秒ごとの読み取り。管理シートに新規下書きが入った場合のみ通知
  timer: null, seen: null, running: false, target: null
};
function oshLegacyInboxIds_(list) {
  if(!Array.isArray(list))throw new Error('下書き一覧の形式が不正です');
  return list.filter(item=>
    item&&typeof item.reportId==='string'&&
    /^R-\d{8}-[a-z0-9]{8}$/i.test(item.reportId) &&
    item.needsDraft!==true && item.test!==true &&
    item.hp!=='published'
  ).map(item=>item.reportId);
}
function oshLegacyInboxRender_(items) {
  const state=OSH_LEGACY_INBOX;
  if(!state.target||!items.length)return;
  const cards=items.map(item=>
    el('button',{class:'b',onclick:()=>{
      oshLegacyInboxStop();
      showDetail(item.reportId);
    }},'新しい下書きを確認：'+item.title));
  put(state.target,
    el('div',{class:'notes','aria-live':'polite'},
      el('b',{},'新しい修理事例の下書きがあります'),
      el('p',{class:'meta'},'管理シートへ登録された下書きです。写真と本文を確認し、承認前に内容を確かめてください。'),
      ...cards));
}
async function oshLegacyInboxCheck_() {
  const state=OSH_LEGACY_INBOX;
  if(state.running||!state.target)return;
  if(typeof document!=='undefined'&&document.visibilityState==='hidden')return;
  state.running=true;
  try{
    const list=await call('oshLegacyReviewInbox'); // 本人確認付きの書込みなし専用API
    const ids=new Set(oshLegacyInboxIds_(list));
    if(state.seen===null){
      state.seen=ids; // 初回の既存案件は新着として扱わない
      return;
    }
    const newlyAdded=list.filter(item=>item&&ids.has(item.reportId)&&
      !state.seen.has(item.reportId));
    newlyAdded.forEach(item=>state.seen.add(item.reportId));
    oshLegacyInboxRender_(newlyAdded);
  }catch(e){
    // 既存call()が画面に失敗理由を出す。更新操作・再試行の連打はしない。
  }finally{
    state.running=false;
  }
}
function oshLegacyInboxStart(target) {
  oshLegacyInboxStop();
  if(!target)return;
  const state=OSH_LEGACY_INBOX;
  state.target=target;
  state.seen=null;
  oshLegacyInboxCheck_();
  state.timer=setInterval(oshLegacyInboxCheck_,state.intervalMs);
}
function oshLegacyInboxStop() {
  const state=OSH_LEGACY_INBOX;
  if(state.timer!==null)clearInterval(state.timer);
  state.timer=null;
  state.target=null;
  state.seen=null;
}

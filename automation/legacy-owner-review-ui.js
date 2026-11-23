/**
 * 本番既存「承認画面_表示.html」の<script>内に組み込むための差分部品。
 * 本番未導入。doGet()、ログイン、公開フローを書き換えない。
 * 既存 el(), put(), call(), render(), toast(), current を再利用する。
 * HTML全体の現物コピーは、顧客データや運用構成の漏えいを防ぐためGitHubへ載せない。
 */

// 本番HPへの反映前に記事の見出し・文章・写真を確認する補助画面。
// この画面はCloudflare本番近似プレビューではなく、あくまで「内容確認用」。
function oshReviewPreview_(v) {
  if (!v || v.needsDraft || !v.hp || !v.gbp) return null;
  const hp=v.hp;
  const photos=(Array.isArray(v.photos)?v.photos:[])
    .filter(p=>p.decision==='ok' && p.url &&
      /^data:image\/(?:jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(p.url));
  const list=Array.isArray(hp.sections)?hp.sections:[];
  const gallery=photos.length
    ? el('div',{class:'photos'},photos.map(p=>el('figure',{
        style:'flex:none;width:72%;max-width:260px;margin:0'
      },el('img',{src:p.url,alt:p.alt||'確認済み写真',
        style:'width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px'}),
        el('figcaption',{class:'meta'},p.alt||'説明文は未設定'))))
    : el('p',{class:'meta'},'公開OKの写真はまだありません。写真確認後に表示されます。');
  return el('section',{id:'osh-preview-article','aria-label':'記事内容の確認用プレビュー'},
    el('div',{class:'head'},el('h3',{},'記事内容の確認用プレビュー')),
    el('p',{class:'meta'},'公開前の内容確認用です。実際のHPと同じデザイン・表示になるかは、別途Cloudflareのプレビューで確認します。'),
    el('div',{style:'padding:10px 0'},
      el('h2',{},v.title||'（タイトル未設定）'),
      el('p',{class:'meta'},'掲載予定日：'+(hp.date||'未設定')+'　地域：'+(v.area||'未設定')),
      el('p',{class:'text'},hp.cardSummary||''),
      gallery,
      ...list.map(s=>el('div',{style:'padding-top:8px'},
        el('h3',{},s.heading||''),
        el('p',{class:'text'},s.text||'')))),
    el('div',{style:'border-top:1px solid #d6dee8;padding-top:12px'},
      el('h3',{},'Google最新情報の投稿イメージ'),
      el('p',{class:'text'},hp&&v.gbp?v.gbp.summary||'':''),
      el('p',{class:'meta'},'Googleにもまだ投稿していません。')));
}

// 写真の「公開OK」をオーナーが既存 apiPhoto で選んだ後、説明文だけを編集。
// サーバー側 oshLegacySetPhotoAlt() がログイン本人・版番号・写真の公開可否を再検証する。
function oshEditPhotoAlt_(photo) {
  const v=current;
  if (!v || !photo || !/^p[1-5]$/.test(photo.id||'')) {
    toast('写真の状態を確認できません',true);return;
  }
  if(photo.decision!=='ok') {
    toast('先に写真を目視確認し、「公開OK」にしてください',true);return;
  }
  const panel=document.getElementById('osh-photo-alt-editor');
  if(!panel){toast('写真説明文の入力欄を表示できません',true);return;}
  const edit=el('textarea',{rows:3,'aria-label':photo.id+'の写真説明文',
    placeholder:'例：水戸市からご来店いただいたお客様のiPhone 15、画面修理後の状態'});
  edit.value=(photo.alt&&photo.alt!=='（altは下書きで作成）')?photo.alt:'';
  const msg=el('p',{class:'meta'},'この写真に実際に写っているものだけを書いてください。個人名・住所・端末画面の情報は入れないでください。');
  const save=el('button',{class:'b primary',onclick:async()=>{
    if(save.disabled)return;
    save.disabled=true;
    try{
      const updated=await call('oshLegacySetPhotoAlt',v.reportId,photo.id,edit.value,v.revision);
      render(updated);
      toast('写真の説明文を保存しました。承認状態を確認してください');
    }catch(e){
      save.disabled=false; // 元の承認画面のcall()が失敗理由を表示
    }
  }},'写真説明文を保存');
  const cancel=el('button',{class:'b',onclick:()=>{
    panel.hidden=true;put(panel);
  }},'やめる');
  put(panel,
    el('h3',{},photo.id+' の写真説明文を編集'),
    msg,edit,el('div',{class:'btns'},save,cancel));
  panel.hidden=false;
  if(typeof panel.scrollIntoView==='function')
    panel.scrollIntoView({behavior:'smooth',block:'center'});
  if(typeof edit.focus==='function')edit.focus();
}

// ローカル専用プレビュー。外部通信・公開・承認操作を行わない。
// node automation/private-preview.mjs --report report.json --out private-preview.html [--photos path/to/<reportId>]
// 写真はHTMLに埋め込まれる。生成HTMLは機密情報として管理し、オンライン公開禁止。
import {readFileSync,writeFileSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const cut=(s,n)=>String(s??'').slice(0,n);
const mediaRe=/^p[1-5]$/;
function getPhoto(folder,id){
  if(!folder)return null;
  for(const [ext,mime,sig] of [
    ['jpg','image/jpeg',[255,216,255]],['jpeg','image/jpeg',[255,216,255]],
    ['png','image/png',[137,80,78,71]],['webp','image/webp',[82,73,70,70]]
  ]){
    let bytes;
    try{bytes=readFileSync(join(folder,id+'.'+ext));}
    catch(e){if(e.code==='ENOENT')continue;throw e;}
    if(bytes.length<16||bytes.length>8*1024*1024)throw Error('画像サイズが不正: '+id);
    if(!sig.every((v,i)=>bytes[i]===v))throw Error('画像形式が不正: '+id);
    if(ext==='webp'&&bytes.toString('ascii',8,12)!=='WEBP')throw Error('WebP画像が不正');
    return 'data:'+mime+';base64,'+bytes.toString('base64');
  }
  return null;
}
function hpBody(r){
  const hp=r.drafts?.hp;
  if(!hp)return '<div class="empty">HP記事の下書きは未作成。修理結果を確認してください。</div>';
  const title=esc(cut(hp.titleDevice||r.facts?.device?.name,150));
  const work=esc((hp.titleServices||[]).slice(0,8).join('・'));
  const sections=(Array.isArray(hp.sections)?hp.sections:[]).slice(0,12).map(s=>{
    const ps=(Array.isArray(s.paragraphs)?s.paragraphs:[]).slice(0,24)
      .map(p=>'<p>'+esc(cut(typeof p==='string'?p:p?.text,3000))+'</p>').join('');
    return '<section><h3>'+esc(cut(s.heading,160))+'</h3>'+ps+'</section>';
  }).join('');
  return '<h2>'+title+'の'+work+'</h2><div class="summary">'+
    esc(cut(hp.description,1500))+'</div>'+sections;
}
function photoCards(r,folder){
  const media=(Array.isArray(r.media)?r.media:[]).slice(0,5);
  if(!media.length)return '<div class="empty">写真データなし</div>';
  return media.map(m=>{
    if(!mediaRe.test(m.id||''))throw Error('写真IDの形式が不正');
    const src=getPhoto(folder,m.id);
    const display=src?'<img src="'+src+'" alt="修理報告の確認用写真">':
      '<div class="empty">画像ファイル未指定／確認待ち</div>';
    const state=m.privacyCheck==='ok'&&m.contentMatch==='ok'?'確認済み':'未確認・公開不可';
    return '<article class="photo"><div class="photo-img">'+display+
      '</div><div class="photo-info"><strong>'+esc(m.id)+'</strong> <small>'+esc(state)+
      '</small><p>'+esc(cut(m.alt,300)||'写真の説明は未確認')+'</p></div></article>';
  }).join('');
}
export function previewHtml(report,{photoDir=null}={}){
  if(!report||!/^R-\d{8}-[a-z0-9]{8}$/i.test(report.reportId||''))
    throw Error('報告IDの形式が不正');
  if(!['draft','review','test'].includes(report.status))
    throw Error('公開前の下書き状態のみ表示できます');
  const name=esc(cut(report.facts?.device?.name,160));
  const area=esc(cut(report.facts?.area?.name,160));
  const stage=esc(report.workflow?.stage||'確認待ち');
  const hold=report.workflow?.stage==='hold';
  const summary=report.drafts?.gbp?.summary?
    esc(cut(report.drafts.gbp.summary,5000)):'Google投稿用の文章はまだありません。';
  const css=':root{font-family:system-ui,-apple-system,sans-serif;color:#262626;background:#fff9f4}'+
    '*{box-sizing:border-box}body{margin:0;line-height:1.8}header{background:#f47719;color:white;padding:16px 5%;font-weight:800}'+
    'main{max-width:900px;margin:auto;padding:26px 16px 70px}h1{font-size:clamp(1.4rem,4vw,2rem)}h2{font-size:1.3rem}h3{font-size:1.05rem}'+
    '.warn{border:2px solid #cc680f;border-radius:12px;padding:15px;background:#fff0e4;margin:20px 0}'+
    '.card{background:white;border:1px solid #e6d9cd;border-radius:14px;padding:18px;margin:18px 0}'+
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px}'+
    '.photo{border:1px solid #e6d9cd;border-radius:12px;overflow:hidden}.photo-img{background:#ece6e1;min-height:130px;display:grid;place-items:center}'+
    '.photo-img img{max-width:100%;max-height:400px;object-fit:contain}.photo-info{padding:12px}'+
    '.photo-info small{background:#fff0e4;border-radius:20px;padding:3px 8px;color:#8f4900}'+
    '.summary{padding:12px;background:#fff9f4;border-radius:8px}.empty{padding:16px;color:#555;background:#f4f1ef}'+
    '.muted{white-space:pre-wrap;overflow-wrap:anywhere;color:#555}footer{font-size:.8rem;color:#666;margin-top:35px}';
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="referrer" content="no-referrer">'+
    '<meta name="robots" content="noindex,nofollow,noarchive,noimageindex">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;; connect-src &#39;none&#39;; form-action &#39;none&#39;; base-uri &#39;none&#39;">'+
    '<title>非公開・承認前プレビュー｜'+name+'</title><style>'+css+'</style></head><body>'+
    '<header>オシスマ｜非公開の確認用プレビュー</header><main>'+
    '<p><strong>公開前・確認専用／承認ボタンなし</strong></p>'+
    '<h1>'+name+'｜'+area+'の修理報告</h1>'+
    '<div class="warn"><strong>'+(hold?'修理結果が未確認・公開保留':'まだ公開されていません')+
    '</strong><p>このHTMLはパソコン内でだけ開く確認用です。HPやGoogleには公開されません。写真の安全確認・プレビュー確認・最終承認が必要です。</p></div>'+
    '<section class="card"><h2>HP記事の下書き</h2>'+hpBody(report)+'</section>'+
    '<section class="card"><h2>修理写真</h2><div class="grid">'+photoCards(report,photoDir)+
    '</div><p class="muted">画像を含むHTMLは機密情報を含む場合があります。共有・公開・クラウドへのアップロードは禁止です。</p></section>'+
    '<section class="card"><h2>Google投稿の文章</h2><div class="muted">'+summary+'</div></section>'+
    '<section class="card"><h2>公開前の確認事項</h2><p>下書き段階：'+stage+
    '</p><p>HP／Googleへの公開：未実施</p><p>加工・個人情報マスクは別途確認が必要です</p></section>'+
    '<footer>報告ID：'+esc(report.reportId)+
    '｜元の報告原文、元写真ID、スタッフの個人情報は表示しません。外部リンク・通信・公開機能はありません。</footer>'+
    '</main></body></html>';
}
export function writePrivatePreview(reportFile,outFile,photoDir=null){
  const report=JSON.parse(readFileSync(reportFile,'utf8'));
  const html=previewHtml(report,{photoDir});
  mkdirSync(dirname(outFile),{recursive:true,mode:0o700});
  writeFileSync(outFile,html,{flag:'wx',mode:0o600});
  try{chmodSync(outFile,0o600)}catch{} // Windowsのファイル権限は別途確認が必要
  return outFile;
}
function arg(argv,key){let i=argv.indexOf(key);return i<0?null:argv[i+1];}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try {
    const input=arg(process.argv,'--report'),out=arg(process.argv,'--out');
    if(!input||!out)throw Error('Usage: --report JSON --out HTML [--photos folder]');
    const output=writePrivatePreview(resolve(input),resolve(out),
      arg(process.argv,'--photos')?resolve(arg(process.argv,'--photos')):null);
    console.log('非公開プレビュー作成：'+output);
    console.log('このファイルは機密扱い。ネット上へ公開・共有しないこと。');
  }catch(e){console.error('作成を停止：'+e.message);process.exitCode=1;}
}

/* オシスマ修理メニュー共通：PCではLINEのQRと操作案内、スマホではLINE直リンク＋案内。
   メインページの導線と案内画像・QRのURLを再利用。公開前プレビューで確認すること。 */
(function(){
"use strict";
const lineURL="https://lin.ee/5w0kuAG";
const guideImg="/optimized/uploads/line-app-usage-guide-tap-icon.webp";
const overlayHTML=`
<div class="repair-modal" id="repair-qr-overlay" hidden>
  <div class="repair-modal-panel" role="dialog" aria-modal="true" aria-labelledby="repair-qr-title" tabindex="-1">
    <div class="repair-modal-heading">
      <h2 id="repair-qr-title">LINEでのご相談はこちら</h2>
      <button type="button" class="repair-modal-close" data-close-dialog="repair-qr-overlay">× 閉じる</button>
    </div>
    <div class="repair-modal-steps">
      <section class="repair-modal-step">
        <div class="repair-step-title"><b>STEP 1</b><h3>QRコードを読み取る</h3></div>
        <p>お手元のスマートフォンをご用意ください。スマホのカメラでQRコードを読み取ると、LINEが開きます。</p>
        <div class="repair-qr-details">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=460x460&amp;margin=8&amp;data=https%3A%2F%2Flin.ee%2F5w0kuAG" width="200" height="200" loading="lazy" decoding="async" alt="オシスマの公式LINEにアクセスするQRコード" class="repair-qr-image">
          <ol>
            <li>スマホのカメラを開く</li>
            <li>QRコードにカメラを向ける（撮影は不要です）</li>
            <li>画面に表示されたLINEのリンクをタップする</li>
          </ol>
        </div>
        <p class="repair-qr-fallback">QRが読み取れない場合：<a href="${lineURL}" target="_blank" rel="noopener noreferrer">公式LINEを開く</a></p>
      </section>
      <section class="repair-modal-step">
        <div class="repair-step-title"><b>STEP 2</b><h3>LINEが開いたら</h3></div>
        <img class="repair-guide-image" loading="lazy" decoding="async" src="${guideImg}" srcset="/optimized/uploads/line-app-usage-guide-tap-icon-480w.webp 480w, /optimized/uploads/line-app-usage-guide-tap-icon.webp 900w" sizes="(max-width:759px) 86vw, 440px" width="1448" height="1086" alt="LINEを開いた後、左下のアイコンをタップしてメッセージを送る手順">
        <p>LINEが開いたら、<strong>左下のアイコン</strong>をタップしてください。その後、いつものLINEと同じようにご相談内容を送れます。</p>
      </section>
    </div>
    <div class="repair-modal-phone"><span>QRコードが難しい場合は、お電話でもご相談いただけます。</span><a href="tel:09050145311">☎ 090-5014-5311</a></div>
  </div>
</div>
<div class="repair-modal repair-mobile-guide-overlay" id="repair-guide-overlay" hidden>
  <div class="repair-modal-panel" role="dialog" aria-modal="true" aria-labelledby="repair-guide-title" tabindex="-1">
    <div class="repair-modal-heading"><h2 id="repair-guide-title">LINEを開いたあとの使い方</h2><button type="button" class="repair-modal-close" data-close-dialog="repair-guide-overlay">× 閉じる</button></div>
    <img class="repair-guide-image" src="${guideImg}" srcset="/optimized/uploads/line-app-usage-guide-tap-icon-480w.webp 480w, /optimized/uploads/line-app-usage-guide-tap-icon.webp 900w" sizes="(max-width:759px) 86vw, 440px" loading="lazy" decoding="async" width="1448" height="1086" alt="LINEで左下のアイコンをタップし、チャットからご相談内容を送る手順">
    <p>LINEが開いたら、<strong>左下のアイコン</strong>をタップして、ご相談内容をメッセージでお送りください。</p>
    <a href="${lineURL}" class="repair-guide-direct">LINEを開く</a>
  </div>
</div>`;
document.body.insertAdjacentHTML("beforeend",overlayHTML);
const qrOverlay=document.getElementById("repair-qr-overlay");
const guideOverlay=document.getElementById("repair-guide-overlay");
let lastFocus=null;
const desktop=window.matchMedia("(min-width:1024px)");
function openDialog(dialog,trigger){
  lastFocus=trigger||document.activeElement;
  dialog.hidden=false;
  document.body.classList.add("repair-dialog-open");
  dialog.querySelector(".repair-modal-panel").focus();
}
function closeDialog(dialog){
  if(!dialog || dialog.hidden)return;
  dialog.hidden=true;
  document.body.classList.remove("repair-dialog-open");
  if(lastFocus && typeof lastFocus.focus==="function")lastFocus.focus();
  lastFocus=null;
}
document.querySelectorAll("[data-line-cta]").forEach(function(a){
  a.addEventListener("click",function(e){
    if(!desktop.matches)return;
    e.preventDefault();
    openDialog(qrOverlay,a);
  });
});
document.querySelectorAll(".repair-guide-trigger").forEach(function(b){
  b.addEventListener("click",function(){openDialog(guideOverlay,b)});
});
document.querySelectorAll("[data-close-dialog]").forEach(function(b){
  b.addEventListener("click",function(){closeDialog(document.getElementById(b.getAttribute("data-close-dialog")))});
});
[qrOverlay,guideOverlay].forEach(function(overlay){
 overlay.addEventListener("click",function(e){if(e.target===overlay)closeDialog(overlay)});
});
document.addEventListener("keydown",function(e){
  const open=!qrOverlay.hidden?qrOverlay:!guideOverlay.hidden?guideOverlay:null;
  if(!open)return;
  if(e.key==="Escape"){e.preventDefault();closeDialog(open);return}
  if(e.key==="Tab"){
    const focusable=Array.from(open.querySelectorAll("a[href],button:not([disabled])")).filter(function(el){return el.getClientRects().length>0});
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  }
});
})();
/* Repair page FAQ: same expand/collapse motion and button copy as homepage. */
document.querySelectorAll(".faq-section .faq-more-toggle").forEach(function(button){
 const id=button.getAttribute("aria-controls");
 const region=document.getElementById(id);
 if(!region)return;
 region.setAttribute("aria-hidden","true");
 region.setAttribute("inert","");
 button.addEventListener("click",function(){
  const expanded=button.getAttribute("aria-expanded")==="true";
  const next=!expanded;
  button.setAttribute("aria-expanded",String(next));
  region.classList.toggle("open",next);
  region.setAttribute("aria-hidden",String(!next));
  if(next)region.removeAttribute("inert");else{
   region.setAttribute("inert","");
   region.querySelectorAll("details[open]").forEach(function(d){d.open=false});
  }
  button.textContent=next?"閉じる ↑":"よくある質問をもっと見る →";
 });
});


/* Repair section chips: accessible click-based horizontal navigation. */
(function(){
  "use strict";
  const nav=document.querySelector(".repair-page-nav");
  if(!nav)return;
  const track=nav.querySelector(".repair-page-nav-track");
  const left=nav.querySelector('[data-repair-direction="-1"]');
  const right=nav.querySelector('[data-repair-direction="1"]');
  if(!track||!left||!right)return;
  function update(){
    left.disabled=track.scrollLeft<=2;
    right.disabled=track.scrollLeft+track.clientWidth>=track.scrollWidth-2;
  }
  [left,right].forEach(function(button){
    button.addEventListener("click",function(){
      const direction=Number(button.getAttribute("data-repair-direction"));
      track.scrollBy({
        left:direction*Math.max(160,Math.round(track.clientWidth*.72)),
        behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"
      });
    });
  });
  track.addEventListener("scroll",update,{passive:true});
  window.addEventListener("resize",update,{passive:true});
  requestAnimationFrame(function(){
    const active=track.querySelector('[aria-current="page"]');
    if(active){
      const leftPos=active.offsetLeft-track.offsetLeft-(track.clientWidth-active.clientWidth)/2;
      track.scrollLeft=Math.max(0,leftPos);
    }
    update();
  });
})();

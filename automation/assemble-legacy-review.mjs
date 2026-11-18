/**
 * Assemble a PRIVATE working copy of the existing Apps Script approval HTML.
 * This script NEVER writes to Google Apps Script or to the production website.
 * The original source is supplied locally at integration time, never committed.
 *
 * node automation/assemble-legacy-review.mjs --input old.html --output revised.html
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const HERE=dirname(fileURLToPath(import.meta.url));
export function insertOnce(source,oldText,newText,step){
  const count=source.split(oldText).length-1;
  if(count!==1)throw new Error('承認画面の構造が変わっています（'+step+'、一致数 '+count+'）。変更を中止しました');
  return source.replace(oldText,newText);
}
export function assembleLegacyReview(html,reviewFunctions,inboxFunctions){
  if(!html.includes('<script>')||!html.includes('</script>')||
     !html.includes('const ALLOWED = <?= allowed ?>;'))
    throw new Error('元の承認画面の形式を確認できません。変更を中止しました');
  if(/function oshReviewPreview_|function oshLegacyInboxStart|osh-photo-alt-editor/.test(html))
    throw new Error('同じ機能が既に入っているため、二重追加しません');
  if(!reviewFunctions.includes('function oshReviewPreview_')||
     !reviewFunctions.includes('function oshEditPhotoAlt_')||
     !inboxFunctions.includes('function oshLegacyInboxStart')||
     !inboxFunctions.includes('function oshLegacyInboxStop'))
    throw new Error('画面用部品が不足しています');
  let result=html;
  result=insertOnce(result,
    "put(app, el('div', { class: 'btns' },",
    "put(app, el('div', { id: 'osh-new-draft-notice' }), el('div', { class: 'btns' },",
    '新着通知表示領域');
  result=insertOnce(result,
    "  });\n}\nconst LABELS =",
    "  });\n  oshLegacyInboxStart(document.getElementById('osh-new-draft-notice'));\n}\nconst LABELS =",
    '一覧表示の新着監視');
  result=insertOnce(result,
    "async function showDetail(id) {\n  put(app,",
    "async function showDetail(id) {\n  oshLegacyInboxStop();\n  put(app,",
    '画面遷移時の通信停止');
  result=insertOnce(result,
    "el('button', { class: 'b danger' + (p.decision === 'ng' ? ' on' : ''), 'aria-pressed': String(p.decision === 'ng'), onclick: () => decide(p.id, 'ng') }, '使わない')))));",
    "el('button', { class: 'b danger' + (p.decision === 'ng' ? ' on' : ''), 'aria-pressed': String(p.decision === 'ng'), onclick: () => decide(p.id, 'ng') }, '使わない'),\n      el('button', { class: 'b', disabled: p.decision !== 'ok', onclick: () => oshEditPhotoAlt_(p) }, '写真の説明文を編集')))));",
    '写真説明文のボタン');
  result=insertOnce(result,
    "photos),\n    el('details', { class: 'meta' }",
    "photos),\n    el('section', { id: 'osh-photo-alt-editor', hidden: true }),\n    el('details', { class: 'meta' }",
    '写真説明文の入力欄');
  result=insertOnce(result,
    ": [channelSection('hp', v), channelSection('gbp', v), photosSection(v),",
    ": [oshReviewPreview_(v), channelSection('hp', v), channelSection('gbp', v), photosSection(v),",
    '記事内容確認プレビュー');
  result=insertOnce(result,
    "if (ALLOWED) showList();",
    reviewFunctions+"\n\n"+inboxFunctions+"\n\nif (ALLOWED) showList();",
    '画面部品の組み込み');
  // 画面全体のJS構文が壊れていないことを検証してから別ファイルへ出力する。
  // Apps Scriptのテンプレート式のみテスト用のbooleanに置換し、実ユーザー情報は埋めない。
  const begin=result.indexOf('<script>');
  const end=result.indexOf('</script>',begin+8);
  if(begin<0 || end<=begin)throw new Error('承認画面のscript部分が見つかりません');
  const js=result.slice(begin+8,end).replace('<?= allowed ?>','false');
  try { new Script(js, { filename:'承認画面_表示.html' }); }
  catch(e) { throw new Error('画面全体のJavaScript構文確認に失敗したため、出力を中止しました: '+e.message); }
  return result;
}
const argv=process.argv.slice(2);
if(argv.length){
  const option=k=>{const i=argv.indexOf(k);return i<0?null:argv[i+1]};
  const input=option('--input'),output=option('--output');
  if(!input||!output||argv.length!==4)
    throw new Error('使い方: node automation/assemble-legacy-review.mjs --input old.html --output revised.html');
  const source=resolve(input),dest=resolve(output);
  if(source===dest||existsSync(dest))
    throw new Error('元ファイルは絶対に上書きしません。新しい出力先を指定してください');
  const review=readFileSync(resolve(HERE,'legacy-owner-review-ui.js'),'utf8');
  const inbox=readFileSync(resolve(HERE,'legacy-review-inbox.js'),'utf8');
  const result=assembleLegacyReview(readFileSync(source,'utf8'),review,inbox);
  writeFileSync(dest,result,{flag:'wx'});
  console.log('別ファイルへ承認画面の組込み案を出力しました。本番には変更を加えていません: '+basename(dest));
}

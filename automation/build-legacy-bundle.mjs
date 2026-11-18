/**
 * Existing Apps Script deployment candidate assembler.
 * No original GAS code, API credentials, customer data, photos, or live services.
 * Original 承認.gs and existing files remain untouched. Output is a NEW file only.
 *
 * Usage: node automation/build-legacy-bundle.mjs --out /private/path/oshisuma-legacy-addon.gs
 * This is a review artifact, NOT a deployment action.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const ROOT=dirname(fileURLToPath(import.meta.url));
export const LEGACY_GAS_MODULES=[
  'legacy-ai-runtime.gs',
  'legacy-draft-payload.gs',
  'legacy-import-bridge.gs',
  'legacy-auto-draft-bridge.gs',
  'legacy-safe-sync.gs',
  'legacy-photo-alt.gs',
  'legacy-readonly-preflight.gs'
];
export const EXCLUDED_LEGACY_GAS=[
  'auto-intake.gs','auto-draft.gs','sheet-sync.gs','owner-preview.gs','photo-approval.gs',
  'integration-preflight.gs'
];
export function assembleLegacyGas(parts) {
  if(!Array.isArray(parts)||parts.length!==LEGACY_GAS_MODULES.length)
    throw new Error('導入するGASファイルの数が正しくありません');
  const blocks=[];
  for(let i=0;i<LEGACY_GAS_MODULES.length;i++){
    const [name,body]=parts[i];
    if(name!==LEGACY_GAS_MODULES[i]||typeof body!=='string'||body.length<150)
      throw new Error('GAS部品の順序・内容が正しくありません');
    if(/(^|\n)\s*function\s+(doGet|apiImport|apiApprove|apiSyncDrafts|requireApprover_)\s*\(/.test(body))
      throw new Error('本番の既存関数を上書きする部品が含まれています');
    blocks.push('// --- '+name+' (review-only, OFF until approved) ---\n'+body.trim());
  }
  const code='/** オシスマ既存管理GASへの追加候補。元スクリプトは保持。本番未導入。 */\n'+
    blocks.join('\n\n')+'\n';
  new Script(code,{filename:'oshisuma-legacy-addon.gs'});
  return code;
}
export function assembleFromRepository(){
  return assembleLegacyGas(LEGACY_GAS_MODULES.map(name=>
    [name,readFileSync(join(ROOT,name),'utf8')]));
}
const args=process.argv.slice(2);
if(args.length){
  if(args.length!==2||args[0]!=='--out'||!args[1])
    throw new Error('使い方: node automation/build-legacy-bundle.mjs --out 新しい出力先.gs');
  const output=resolve(args[1]);
  if(existsSync(output))throw new Error('既存ファイルの上書きを禁止しました');
  const code=assembleFromRepository();
  writeFileSync(output,code,{flag:'wx'});
  console.log('確認用のGAS追加候補を作成しました。本番への導入・実行は未実施です');
}

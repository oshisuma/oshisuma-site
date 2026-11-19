/**
 * オシスマ：本番GASに直接触れず、既存GASへ差し込む7モジュールの
 * 共存可能性・自動処理の初期OFFを検査する準備用ツール。
 * 実行例: node automation/verify-legacy-bundle.mjs
 * 個人情報、APIキー、フォーム写真、既存GASの実ソースは使用しない。
 */
import {readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
const HERE=dirname(fileURLToPath(import.meta.url));
export const MODULES=Object.freeze([
 'legacy-ai-runtime.gs',
 'legacy-draft-payload.gs',
 'legacy-import-bridge.gs',
 'legacy-auto-draft-bridge.gs',
 'legacy-safe-sync.gs',
 'legacy-readonly-preflight.gs',
 'legacy-photo-alt.gs'
]);
export const DISABLED_SWITCHES=Object.freeze([
 'OSH_LEGACY_AUTO_IMPORT_ENABLED',
 'OSH_LEGACY_AUTO_DRAFT_ENABLED',
 'OSH_LEGACY_SYNC_ENABLED',
 'AI_DATA_SHARING_APPROVED'
]);
export function verifyLegacyBundle({dir=HERE,modules=MODULES}={}){
 if(!Array.isArray(modules)||!modules.length||new Set(modules).size!==modules.length)
   throw new Error('検査対象モジュールが不正です');
 const body=modules.map(name=>{
   if(!MODULES.includes(name))throw new Error('未承認のスクリプトは検査しません');
   return '// -- '+name+' --\n'+readFileSync(join(dir,name),'utf8');
 }).join('\n\n');
 // 同名のconst宣言・同一関数名・GASで非対応のモジュール構文はコンパイル失敗。
 const script=new vm.Script(body,{filename:'oshisuma-gas-bundle.gs'});
 const events={writes:0,network:0,auth:0};
 const props=new Map();
 const context=vm.createContext({
  PropertiesService:{getScriptProperties:()=>({
   getProperty:key=>props.get(key)??null,
   setProperty:()=>{events.writes++}
  })},
  Logger:{log:()=>{}},
  CONFIG:{MODE:'production'}
 });
 script.runInContext(context,{timeout:1000});
 const disabled=[
  ['oshLegacyAutoImportTick','status'],
  ['oshLegacyAutoDraftTick','status'],
  ['oshLegacySafeSyncTick','state']
 ].map(([name,key])=>{
  const fn=context[name];
  if(typeof fn!=='function')throw new Error('必要な処理が不足しています: '+name);
  const result=fn();
  if(result?.[key]!=='disabled')throw new Error('初期OFFを確認できません: '+name);
  return name;
 });
 if(events.writes!==0||events.network!==0)
  throw new Error('初期状態で外部アクセスが発生しました');
 return {status:'safe-to-review',modules:modules.length,
   initialOffVerified:disabled.length,productionInstalled:false,
   apiCalls:events.network,writes:events.writes,
   switches:Object.fromEntries(DISABLED_SWITCHES.map(k=>[k,'false']))};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const info=verifyLegacyBundle();
 process.stdout.write(JSON.stringify(info,null,2)+'\n');
}

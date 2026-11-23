// オシスマ修理事例: Chromium系のローカルブラウザで安全に写真を描き直す。
// Windows Edgeに加え、macOS / Linux（GitHub ActionsのUbuntuなど）のChromeを使用可能にする。
// 生写真はローカルで処理し、GitHub Actionsへ自動送信しない。実画像のクラウド移行は別途プライバシー審査が必要。
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { ROOT } from './lib.mjs';

export function browserCandidates(platform = process.platform, env = process.env) {
  const explicit = [env.PHOTO_BROWSER_PATH, env.EDGE_PATH].filter(Boolean);
  if (platform === 'win32') return [...explicit,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe'];
  if (platform === 'darwin') return [...explicit,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'];
  return [...explicit, '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome'];
}

export function findBrowser(platform = process.platform, env = process.env, exists = existsSync) {
  const candidate = browserCandidates(platform, env).find((path) => exists(path));
  if (!candidate) throw new Error(
    'Chrome/Edge/Chromiumが見つかりません。PHOTO_BROWSER_PATHに実行ファイルの絶対パスを設定してください。');
  return candidate;
}

export function imageMimeFromFilename(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.heic' || ext === '.heif') {
    // 多くのChromium環境でHEICのデコード可否が異なる。明示的に停止し、偽のjpegにしない。
    throw new Error('HEIC写真はブラウザごとに対応が違うため、安全確認のうえJPEGまたはPNGへ変換してください。元画像は残してください。');
  }
  throw new Error('未対応の写真形式です: ' + ext);
}

export async function startBrowser() {
  const executable = findBrowser();
  if (typeof WebSocket !== 'function')
    throw new Error('Node.js 22以上のWebSocket対応環境が必要です。');
  const profile = mkdtempSync(join(tmpdir(), 'oshisuma-photo-'));
  const proc = spawn(executable,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-background-networking', '--disable-sync',
      '--disable-features=Translate', '--user-data-dir=' + profile,
      '--remote-debugging-port=0', 'about:blank'],
    { stdio:'ignore' });
  const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  const cleanup=()=>{
    try { proc.kill(); } catch { /* 終了済み */ }
    try { rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100}); } catch { /* Windowsは使用中のことがある */ }
  };
  let wsUrl;
  for(let i=0;i<100&&!wsUrl;i++){
    await sleep(200);
    if(proc.exitCode!==null)break;
    try {
      const port=readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
      const response=await fetch('http://127.0.0.1:'+port+'/json/list');
      wsUrl=(await response.json()).find(x=>x.type==='page')?.webSocketDebuggerUrl;
    }catch{ /* 起動を待つ */ }
  }
  if(!wsUrl){cleanup();throw new Error('Chrome/Edgeを起動できませんでした。');}
  const ws=new WebSocket(wsUrl);
  try{
    await Promise.race([
      new Promise((resolve,reject)=>{
        ws.addEventListener('open',resolve,{once:true});
        ws.addEventListener('error',()=>reject(new Error('ブラウザへの接続に失敗しました')),{once:true});
      }),
      sleep(10000).then(()=>{throw new Error('ブラウザへの接続がタイムアウトしました');})
    ]);
    let seq=0;
    const pending=new Map();
    ws.addEventListener('message',event=>{
      let response;
      try{response=JSON.parse(event.data);}catch{return;}
      if(response.id&&pending.has(response.id)){
        pending.get(response.id)(response);
        pending.delete(response.id);
      }
    });
    const send=(method,params={})=>new Promise((resolve,reject)=>{
      if(ws.readyState!==WebSocket.OPEN){reject(new Error('ブラウザの接続が切れています'));return;}
      const id=++seq;
      pending.set(id,resolve);
      ws.send(JSON.stringify({id,method,params}));
      // 呼び出しが終了しないときは、写真を公開せず停止する。
      setTimeout(()=>{
        if(pending.has(id)){pending.delete(id);reject(new Error('写真処理がタイムアウトしました'));}
      },60000).unref?.();
    });
    const evaluate=async(expression)=>{
      const message=await send('Runtime.evaluate',{
        expression,returnByValue:true,awaitPromise:true
      });
      if(message.error)throw new Error('ブラウザの写真処理命令が失敗しました');
      if(message.result?.exceptionDetails)
        throw new Error(message.result.exceptionDetails.exception?.description||'画像処理エラー');
      return message.result?.result?.value;
    };
    await evaluate(readFileSync(join(ROOT,'tools/cases/photo-process.js'),'utf8'));
    return {evaluate,close:()=>{
      try{ws.close();}catch{ /* 終了済み */ }
      cleanup();
    }};
  }catch(e){try{ws.close();}catch{}cleanup();throw e;}
}

export function processPhoto(browser,file,renditions,region,options=null) {
  const mime=imageMimeFromFilename(file);
  const b64=readFileSync(file).toString('base64');
  return browser.evaluate('(async()=>{' +
    'const bin=atob('+JSON.stringify(b64)+');' +
    'const bytes=new Uint8Array(bin.length);' +
    'for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);' +
    'return OshismaPhoto.process(new Blob([bytes],{type:'+JSON.stringify(mime)+'}),'+
      JSON.stringify(renditions)+','+JSON.stringify(region||null)+','+
      JSON.stringify(options||null)+');' +
  '})()');
}

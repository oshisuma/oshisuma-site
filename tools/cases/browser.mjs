// photo-process.js を、このパソコンのEdge（画面なし）で動かすための部品
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { ROOT } from './lib.mjs';

const EDGE = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

export async function startBrowser() {
  const profile = mkdtempSync(join(tmpdir(), 'oshisuma-photo-'));
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
    '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await sleep(200);
    try {
      const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* 起動待ち */ }
  }
  if (!wsUrl) { proc.kill(); throw new Error('Edgeを起動できませんでした。'); }
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let seq = 0;
  const pending = {};
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } });
  const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending[id] = res; ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const m = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description || 'ブラウザ内でエラー');
    return m.result?.result?.value;
  };
  await evaluate(readFileSync(join(ROOT, 'tools/cases/photo-process.js'), 'utf8'));
  return { evaluate, close: () => { try { ws.close(); } catch { /* 終了 */ } proc.kill(); } };
}

// 元写真（ファイル）から、renditions で指定した公開用の画像を作る
export function processPhoto(browser, file, renditions, region) {
  const b64 = readFileSync(file).toString('base64');
  return browser.evaluate(`(async () => {
    const bin = atob(${JSON.stringify(b64)});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return OshismaPhoto.process(new Blob([bytes], { type: 'image/jpeg' }), ${JSON.stringify(renditions)}, ${JSON.stringify(region || null)});
  })()`);
}

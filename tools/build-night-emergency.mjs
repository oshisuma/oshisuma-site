// iPhone限定・夜23時までの緊急電話受付をトップとiPhoneページだけへ差し込む。
// 使い方：node tools/build-night-emergency.mjs
// 文章・デザインは components/night-emergency/ の2ファイルだけを編集し、このスクリプトを再実行する。
// 目印コメントの間だけを書き換えるので、ほかの部分は変更しない。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'components/night-emergency');
const html = readFileSync(path.join(dir, 'night-emergency.html'), 'utf8').trim();
const css = readFileSync(path.join(dir, 'night-emergency.css'), 'utf8');
const version = createHash('sha256').update(css).digest('hex').slice(0, 10);

// 初回の差し込み位置（2回目以降は目印コメントの間を置き換える）
const pages = [
  { file: 'index.html', before: '<section id="service" hidden' },  // ヒーロー・情報帯の直後
  { file: 'repair/iphone/index.html', after: '<main>' }             // ヒーローの直後
];

const block = (name, body) =>
  `<!-- night-emergency:${name}:start（編集は components/night-emergency/ で） -->${body}<!-- night-emergency:${name}:end -->`;
const linkTag = `<link rel="stylesheet" href="/components/night-emergency/night-emergency.css?v=${version}">`;

function upsert(source, name, body, anchor) {
  const re = new RegExp(`<!-- night-emergency:${name}:start[\\s\\S]*?<!-- night-emergency:${name}:end -->`);
  const replacement = block(name, body);
  if (re.test(source)) return source.replace(re, () => replacement);
  const target = anchor.before ?? anchor.after;
  const count = source.split(target).length - 1;
  if (count !== 1) throw new Error(`差し込み位置「${target}」が ${count} 件あります（1件である必要があります）`);
  return source.replace(target, () => (anchor.before ? replacement + '\n' + target : target + '\n' + replacement));
}

for (const page of pages) {
  const file = path.join(root, page.file);
  const before = readFileSync(file, 'utf8');
  let after = upsert(before, 'css', linkTag, { before: '</head>' });
  after = upsert(after, 'section', '\n' + html + '\n', page);
  if (after !== before) writeFileSync(file, after);
  console.log(`${after !== before ? '更新' : '変更なし'}：${page.file}`);
}

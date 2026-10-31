// 修理ページ（/repair/ の5ページ）のスマホ用改行ポイントを入れ直すツール。
//
// 日本語の文章を「意味のまとまり（文節）」で区切り、区切りに <wbr>（ここで改行してよい印）を入れる。
// スマホ幅では repair.css の word-break:keep-all により、この印の位置でだけ改行される。
// PC・タブレットでは見た目は変わらない。
//
// 使い方：文章を直したあとに  node tools/repair-linebreak.mjs  を実行する（何度実行しても同じ結果）。
// 確認だけ：                  node tools/repair-linebreak.mjs --check（入れ直しが必要なら終了コード1）
import { readFileSync, writeFileSync } from "node:fs";

const FILES = ["repair/index.html", "repair/iphone/index.html", "repair/android/index.html", "repair/ipad/index.html", "repair/switch/index.html"];
// 対象範囲：ページ上部（hero）から店舗情報まで。ヘッダー・フッター・head 内は触らない
const START = '<div class="hero', END = "<footer";
const SKIP = new Set(["script", "style", "svg", "title", "textarea"]);

const HIRA = /[ぁ-ゖゝゞ]/;
const CLOSE = /[、。，．」』）)】！？!?／・]/;          // この後ろで改行してよい
const OPEN = /[「『（(【]/;                              // この前で改行してよい
const PARTICLE = new Set(["を", "が", "は", "に", "で", "と", "も", "へ", "や"]);
const PREFIX = new Set(["お", "ご"]);
const HEAD_PARTICLE = new Set(["を", "が", "は", "も"]);   // 漢字・カタカナの直後にあり、後ろにひらがなが続く助詞

// 1つの文字列を文節に分ける
function chunks(text) {
  const cls = [];
  for (const ch of text) cls.push(ch === "ー" ? (cls.at(-1) ?? "K") : HIRA.test(ch) ? "H" : CLOSE.test(ch) ? "C" : OPEN.test(ch) ? "O" : /\s/.test(ch) ? "S" : "K");
  const chars = [...text], cuts = new Set();
  for (let i = 1; i < chars.length; i++) {
    const a = cls[i - 1], b = cls[i];
    if (a === "S" || b === "S") continue;
    if (a === "C" && b !== "C") { if (!(/[」』）)]/.test(chars[i - 1]) && b === "H")) cuts.add(i); continue; }   // 「（劣化具合）は」は離さない
    if (b === "O" && a !== "O") { cuts.add(i); continue; }
    if (a === "H" && b === "K") {
      let s = i - 1; while (s > 0 && cls[s - 1] === "H") s--;
      const run = chars.slice(s, i).join("");
      if (run.length >= 2) cuts.add(PREFIX.has(run.at(-1)) ? i - 1 : i);   // 「〜に|ご案内」
      else if (PARTICLE.has(run)) cuts.add(i);                             // 1文字の助詞のあと
    }
  }
  // ひらがなが長く続く部分の中の区切り：「型番が|わからない」「ことは|ありますか」
  for (let i = 0; i < chars.length; i++) {
    if (cls[i] !== "H" || (i > 0 && cls[i - 1] === "H")) continue;
    let e = i; while (e < chars.length && cls[e] === "H") e++;
    const run = chars.slice(i, e).join("");
    if (i > 0 && cls[i - 1] === "K" && HEAD_PARTICLE.has(run[0]) && run.length >= 3 && !(run[0] === "が" && /[っるりられろ]/.test(run[1]))) cuts.add(i + 1);   // 「広がった」は分けない
    for (const m of run.matchAll(/(?:こと|もの|わけ|よう)(?:では|は|が|を|も|に)(?=.)/g)) cuts.add(i + m.index + m[0].length);
  }
  const out = []; let cur = "";
  chars.forEach((ch, i) => { if (cuts.has(i) && cur) { out.push(cur); cur = ""; } cur += ch; });
  if (cur) out.push(cur);
  // 1文字だけのかたまりは前とつなげる（「お」「ご」だけが残る等を防ぐ）
  const merged = [];
  for (const c of out) {
    const core = c.replace(/[、。，．」』）)】！？!?／・「『（(【\s]/g, "");
    if (merged.length && core.length <= 1 && !/\s$/.test(merged.at(-1))) merged[merged.length - 1] += c; else merged.push(c);
  }
  return merged;
}

// 文字列 a と b がタグをはさんで続くとき、つなぎ目が文節の区切りになるか
function cutsAtJoin(a, b) {
  if (!b || /\s$/.test(a) || /^\s/.test(b)) return false;
  const tail = [...a].slice(-8).join(""), head = [...b].slice(0, 8).join("");
  let n = 0; const at = [...tail].length;
  for (const c of chunks(tail + head)) { n += [...c].length; if (n === at) return true; if (n > at) return false; }
  return false;
}
// 次の文字（a・strong などの文中のタグだけをはさむ場合）
function nextText(tokens, i) {
  for (let j = i + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (!t.startsWith("<")) return t;
    if (!/^<\/?(a|span|strong|b|em|small)\b/i.test(t)) return "";
  }
  return "";
}

function processRegion(html) {
  const tokens = html.replace(/<wbr>/g, "").split(/(<[^>]+>)/);
  const stack = []; let inH1 = false, noBreak = 0;   // noBreak: 改行させないまとまり（.repair-no-break）の中
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith("<")) {
      const m = t.match(/^<\/?([a-zA-Z0-9]+)/); if (!m) continue;
      const name = m[1].toLowerCase();
      if (name === "h1") inH1 = t[1] !== "/";
      if (name === "span") { if (t[1] === "/") { if (noBreak) noBreak--; } else if (noBreak || /class="[^"]*repair-no-break/.test(t)) noBreak++; }
      if (SKIP.has(name) && !t.endsWith("/>")) { if (t[1] === "/") stack.pop(); else stack.push(name); }
      continue;
    }
    if (stack.length || noBreak || !/[^\x00-\x7F]/.test(t)) continue;
    // 英単語どうしの空白（Face ID / Google Pixel など）では改行しない（大見出しの「Nintendo Switch修理」は空白で改行してよい）
    let s = inH1 ? t : t.replace(/([A-Za-z0-9])[ ](?=[A-Za-z0-9])/g, "$1 ");
    s = chunks(s).join("<wbr>");
    if (/[、。，．」』）)】！？!?／・]$/.test(s.trimEnd()) && !/\s$/.test(s)) s += "<wbr>";
    else if (!s.endsWith("<wbr>") && cutsAtJoin(t, nextText(tokens, i))) s += "<wbr>";   // リンクなどの直前：「ご案内は|<a>トップページ」
    tokens[i] = s;
  }
  return tokens.join("");
}

const check = process.argv.includes("--check");
let changed = 0;
for (const f of FILES) {
  const src = readFileSync(f, "utf8");
  const a = src.indexOf(START), b = src.indexOf(END, a);
  if (a < 0 || b < 0) { console.error(`${f}: 対象範囲が見つかりません`); process.exitCode = 1; continue; }
  const out = src.slice(0, a) + processRegion(src.slice(a, b)) + src.slice(b);
  if (out !== src) { changed++; if (check) console.log(`入れ直しが必要: ${f}`); else writeFileSync(f, out); }
}
if (check && changed) process.exitCode = 1;
console.log(check ? (changed ? "改行ポイントの入れ直しが必要です" : "OK") : `${changed} ファイルを更新しました`);

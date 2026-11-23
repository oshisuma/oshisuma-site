// 公開用の写真を作るブラウザ用の処理（段階②）
// 同じ処理を、テスト（このパソコンのEdge）と、今後のスマホ確認ページの両方で使う。
// - スマホの写真の向き（EXIFの回転情報）を反映してから描き直す
// - 描き直すことで、位置情報（GPS）・撮影機器などの撮影情報はすべて消える
// - 元の写真は変更しない（新しい画像を作るだけ）
//
// 処理の順番（公開用のコピーだけ）
//   ① 個人情報などの塗りつぶし・ぼかし（redact）
//   ② 傾きの修正（rotate：AIが決めた角度。余白が出ないよう少し拡大）
//   ③ 画質の補正（enhance）… 写真全体に同じ調整をするだけ。部分的な描き足し・消去はしない
//        明るさ・コントラスト（軽いくもり・指紋の白っぽさも軽減）・ホワイトバランス・色味を控えめに整え、
//        細かいノイズだけをならし、輪郭は少しだけ鮮明にする（傷・割れ・故障箇所などのはっきりした線はそのまま残す）
//        補正の前後で画質を測り、悪くなるときは補正しない
//   ④ 切り抜き・大きさの調整（renditions）
(function (global) {
  'use strict';

  function loadBitmap(blob) {
    return createImageBitmap(blob, { imageOrientation: 'from-image' });
  }

  // spec: { mode: 'fit', maxW, maxH } … 縦横比を保って枠に収める（拡大はしない）
  //       { mode: 'cover', w, h, focusX, focusY } … 指定の大きさで切り抜く（focus は 0〜1、既定は中央）
  function layout(bw, bh, spec) {
    if (spec.mode === 'fit') {
      const scale = Math.min(1, spec.maxW / bw, spec.maxH / bh);
      const w = Math.round(bw * scale);
      const h = Math.round(bh * scale);
      return { w, h, sx: 0, sy: 0, sw: bw, sh: bh };
    }
    const target = spec.w / spec.h;
    let sw = bw;
    let sh = bw / target;
    if (sh > bh) { sh = bh; sw = bh * target; }
    const fx = spec.focusX == null ? 0.5 : spec.focusX;
    const fy = spec.focusY == null ? 0.5 : spec.focusY;
    const sx = Math.min(Math.max(bw * fx - sw / 2, 0), bw - sw);
    const sy = Math.min(Math.max(bh * fy - sh / 2, 0), bh - sh);
    return { w: spec.w, h: spec.h, sx, sy, sw, sh };
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function blobToBase64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function canvasOf(src, w, h) {
    const c = document.createElement('canvas');
    c.width = w || src.width;
    c.height = h || src.height;
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  // ---------------------------------------------------------------- ① 個人情報などを読み取れなくする
  // 写真の向きを直した後の、写真全体に対する 0〜1 の位置
  //   method 'fill' … 塗りつぶし（文字・QRコード・番号・画面など。確実に読めなくする）
  //   method 'blur' … 強いモザイク＋ぼかし（背景の書類・人など、形が残ってもよいもの）
  function redact(bmp, redactions) {
    const c = canvasOf(bmp);
    const ctx = c.getContext('2d');
    const long = Math.max(bmp.width, bmp.height);
    // 範囲の少しのずれで端が残らないよう、写真の長い辺の1%ぶん外側まで広げて処理する
    const pad = Math.round(long * 0.01);
    for (const r of redactions || []) {
      const x = Math.max(0, Math.floor(bmp.width * r.x) - pad);
      const y = Math.max(0, Math.floor(bmp.height * r.y) - pad);
      const w = Math.min(bmp.width - x, Math.ceil(bmp.width * r.w) + pad * 2);
      const h = Math.min(bmp.height - y, Math.ceil(bmp.height * r.h) + pad * 2);
      if (w <= 0 || h <= 0) continue;
      if (r.method === 'blur') {
        // 小さく縮めてから戻す（モザイク）→ さらにぼかす。細かい文字・線は残らない
        const block = Math.max(24, Math.round(long * 0.04));
        const t = document.createElement('canvas');
        t.width = Math.max(1, Math.ceil(w / block));
        t.height = Math.max(1, Math.ceil(h / block));
        const tc = t.getContext('2d');
        tc.imageSmoothingQuality = 'high';
        tc.drawImage(c, x, y, w, h, 0, 0, t.width, t.height);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.imageSmoothingEnabled = true;
        // まず不透明なモザイクで完全に覆う（ぼかしのふちから元の写真が透けないように）
        ctx.drawImage(t, 0, 0, t.width, t.height, x, y, w, h);
        ctx.filter = `blur(${Math.round(block / 2)}px)`;
        ctx.drawImage(t, 0, 0, t.width, t.height, x - block, y - block, w + block * 2, h + block * 2);
        ctx.filter = 'none';
        ctx.restore();
      } else {
        // 落ち着いた色で塗りつぶす（不自然に目立たせない）
        ctx.fillStyle = r.color || '#5f6368';
        ctx.fillRect(x, y, w, h);
      }
    }
    return c;
  }

  // ---------------------------------------------------------------- ② 傾きの修正
  // deg … 時計回りを正とする角度（-8〜8 度）。余白が出ないよう、必要な分だけ拡大して中央を使う
  // 返す mapRect … 元の写真の上の範囲（0〜1）が、修正後の写真のどこに来るか（内側に収まる長方形）
  function rotate(src, deg) {
    const W = src.width, H = src.height;
    const t = Math.abs(deg) * Math.PI / 180;
    const s = Math.max((W * Math.cos(t) + H * Math.sin(t)) / W, (W * Math.sin(t) + H * Math.cos(t)) / H);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(W / 2, H / 2);
    ctx.rotate(deg * Math.PI / 180);
    ctx.scale(s, s);
    ctx.drawImage(src, -W / 2, -H / 2);
    const mapRect = (q) => {
      const cx = (q.x + q.w / 2) * W - W / 2, cy = (q.y + q.h / 2) * H - H / 2;
      const a = deg * Math.PI / 180;
      const nx = s * (cx * Math.cos(a) - cy * Math.sin(a)) + W / 2;
      const ny = s * (cx * Math.sin(a) + cy * Math.cos(a)) + H / 2;
      // 回った長方形の内側に収まる、軸に沿った長方形
      const w = s * (q.w * W * Math.cos(t) - q.h * H * Math.sin(t));
      const h = s * (q.h * H * Math.cos(t) - q.w * W * Math.sin(t));
      if (w <= 0 || h <= 0) return { x: nx / W, y: ny / H, w: 0, h: 0, method: q.method };
      return { x: (nx - w / 2) / W, y: (ny - h / 2) / H, w: w / W, h: h / H, method: q.method };
    };
    return { canvas: c, mapRect };
  }

  // ---------------------------------------------------------------- ③ 画質の補正
  // 写真の画質を測る（処理した部分は除く）
  //   mean … 明るさの平均（0〜1）／clipLow・clipHigh … 黒つぶれ・白とびの割合／cast … 色かぶりの強さ
  //   contrast … 明るさのばらつき／sharp … 輪郭の鮮明さ（となりとの差の平均）／noise … 平らな部分の細かいざらつき
  function stats(data, w, h, exclude) {
    const inEx = (x, y) => exclude.some((q) => x >= q.x0 && x < q.x1 && y >= q.y0 && y < q.y1);
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250000)));
    const hist = new Float64Array(256);
    let n = 0, sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, low = 0, high = 0, sharp = 0, sharpN = 0, noise = 0, noiseN = 0;
    for (let y = 0; y < h - step; y += step) {
      for (let x = 0; x < w - step; x += step) {
        if (exclude.length && inEx(x, y)) continue;
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        hist[Math.min(255, Math.round(l))]++;
        n++; sl += l; sl2 += l * l;
        if (l >= 30 && l <= 225) { sr += r; sg += g; sb += b; }
        if (l <= 3) low++;
        if (l >= 252) high++;
        const j = i + 4, k = i + w * 4;
        const lj = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
        const lk = 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
        const d = (Math.abs(l - lj) + Math.abs(l - lk)) / 2;
        sharp += d; sharpN++;
        if (d < 6) { noise += d; noiseN++; }
      }
    }
    const m = sr + sg + sb ? (sr + sg + sb) / 3 : 1;
    const mean = n ? sl / n / 255 : 0;
    return {
      hist, n, mean,
      contrast: n ? Math.sqrt(Math.max(0, sl2 / n - (sl / n) ** 2)) / 255 : 0,
      clipLow: n ? low / n : 0, clipHigh: n ? high / n : 0,
      cast: m ? (Math.max(sr, sg, sb) - Math.min(sr, sg, sb)) / 3 / m : 0,
      gains: [m / (sr || m), m / (sg || m), m / (sb || m)],
      sharp: sharpN ? sharp / sharpN : 0, noise: noiseN ? noise / noiseN : 0
    };
  }
  const pct = (hist, n, p) => { let s = 0; for (let i = 0; i < 256; i++) { s += hist[i]; if (s >= n * p) return i; } return 255; };
  const lim = (v, a, b) => Math.min(b, Math.max(a, v));

  // 写真全体に同じ調整をする（部分的な描き足し・消去はしない）。強さには上限がある
  function enhance(canvas, exclude) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const before = stats(d, w, h, exclude);
    // 明るさ・コントラスト：暗い側・明るい側の端（0.5%）を少しだけ広げる（最大1.25倍）。軽いくもり・指紋の白っぽさも和らぐ
    let lo = Math.min(pct(before.hist, before.n, 0.005), 40);
    let hi = Math.max(pct(before.hist, before.n, 0.995), 200);
    if (255 / (hi - lo) > 1.25) { const mid = (hi + lo) / 2, half = 255 / 1.25 / 2; lo = mid - half; hi = mid + half; }
    // ホワイトバランス：色かぶりを6割だけ戻す（各色±10%まで）
    const gains = before.gains.map((g) => 1 + (lim(g, 0.9, 1.1) - 1) * 0.6);
    // 明るさ：平均が0.47に近づくように（ガンマ 0.8〜1.2）
    const m1 = lim((before.mean * 255 - lo) / (hi - lo), 0.05, 0.95);
    const gamma = lim(Math.log(0.47) / Math.log(m1), 0.8, 1.2);
    const lut = [0, 1, 2].map((c) => {
      const t = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) t[v] = Math.round(255 * Math.pow(lim((v * gains[c] - lo) / (hi - lo), 0, 1), gamma));
      return t;
    });
    const sat = 1.05;   // 色味：ほんの少しだけ鮮やかに
    for (let i = 0; i < d.length; i += 4) {
      const r = lut[0][d[i]], g = lut[1][d[i + 1]], b = lut[2][d[i + 2]];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      d[i] = l + (r - l) * sat; d[i + 1] = l + (g - l) * sat; d[i + 2] = l + (b - l) * sat;
    }
    // ノイズ・鮮明度：3×3の平均との差が小さい（細かいざらつき）ところだけをならし、
    // 差が大きい（輪郭・傷・割れなど）ところはそのまま少しだけくっきりさせる
    const src = new Uint8ClampedArray(d);
    const W4 = w * 4;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * W4 + x * 4;
        for (let c = 0; c < 3; c++) {
          const k = i + c;
          const avg = (src[k - W4 - 4] + src[k - W4] + src[k - W4 + 4] + src[k - 4] + src[k] + src[k + 4] + src[k + W4 - 4] + src[k + W4] + src[k + W4 + 4]) / 9;
          const diff = src[k] - avg;
          d[k] = Math.abs(diff) < 4 ? src[k] - diff * 0.5 : src[k] + diff * 0.3;
        }
      }
    }
    const after = stats(d, w, h, exclude);
    // 安全確認：補正で悪くなっていないか（悪くなるなら、補正しない）
    const problems = [];
    if (after.clipHigh > Math.max(before.clipHigh * 1.5 + 0.003, 0.01)) problems.push('白とびが増える');
    if (after.clipLow > Math.max(before.clipLow * 1.5 + 0.003, 0.01)) problems.push('黒つぶれが増える');
    if (after.cast > before.cast + 0.01) problems.push('色かぶりが強くなる');
    if (after.sharp < before.sharp * 0.9) problems.push('輪郭がぼやける');
    if (after.noise > before.noise * 1.25 + 0.05) problems.push('ざらつきが目立つ');
    if (Math.abs(after.mean - 0.47) > Math.abs(before.mean - 0.47) + 0.03) problems.push('明るさが不自然になる');
    const summary = (s) => ({ mean: +s.mean.toFixed(3), contrast: +s.contrast.toFixed(3), clipLow: +s.clipLow.toFixed(4), clipHigh: +s.clipHigh.toFixed(4), cast: +s.cast.toFixed(4), sharp: +s.sharp.toFixed(2), noise: +s.noise.toFixed(2) });
    const quality = { applied: !problems.length, problems, before: summary(before), after: summary(after), settings: { lo: +lo.toFixed(1), hi: +hi.toFixed(1), gamma: +gamma.toFixed(3), gains: gains.map((g) => +g.toFixed(3)), saturation: sat } };
    if (quality.applied) ctx.putImageData(img, 0, 0);
    return quality;
  }

  // ---------------------------------------------------------------- 測定（確認用）
  // 画像の決まった範囲に、細かい模様（文字・線）が残っていないかを測る（公開用の画像の確認用）
  // 返す値：edge … となりの点との明るさの差の平均（文字や線があると大きい）、std … 明るさのばらつき
  async function measure(blob, rects) {
    const bmp = await createImageBitmap(blob);
    const c = canvasOf(bmp);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const out = rects.map((r) => {
      // 境目（ぼかしのふち・JPEGのにじみ）を除くため、内側だけを測る
      const mx = r.w * 0.15;
      const my = r.h * 0.15;
      const x = Math.max(0, Math.floor((r.x + mx) * bmp.width));
      const y = Math.max(0, Math.floor((r.y + my) * bmp.height));
      const w = Math.min(bmp.width - x, Math.floor((r.w - 2 * mx) * bmp.width));
      const h = Math.min(bmp.height - y, Math.floor((r.h - 2 * my) * bmp.height));
      if (w < 3 || h < 3) return { edge: 0, std: 0, pixels: 0 };
      const d = ctx.getImageData(x, y, w, h).data;
      const lum = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      let sum = 0, sum2 = 0, edge = 0, n = 0;
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const v = lum[j * w + i];
          sum += v; sum2 += v * v;
          if (i + 1 < w && j + 1 < h) { edge += Math.abs(v - lum[j * w + i + 1]) + Math.abs(v - lum[(j + 1) * w + i]); n++; }
        }
      }
      const mean = sum / (w * h);
      return { edge: n ? edge / n / 2 : 0, std: Math.sqrt(Math.max(0, sum2 / (w * h) - mean * mean)), mean, pixels: w * h };
    });
    bmp.close();
    return out;
  }

  // 2つの画像の同じ範囲の「形」がどれだけ同じか（明るさの相関 -1〜1）。全体の明るさ・色の調整だけなら 1 に近い（確認用）
  async function similarity(blobA, blobB, rect) {
    const get = async (blob) => {
      const bmp = await createImageBitmap(blob);
      const c = canvasOf(bmp, 400, Math.round(400 * bmp.height / bmp.width));
      bmp.close();
      const x = Math.floor(rect.x * c.width), y = Math.floor(rect.y * c.height);
      const w = Math.max(2, Math.floor(rect.w * c.width)), h = Math.max(2, Math.floor(rect.h * c.height));
      const d = c.getContext('2d').getImageData(x, y, w, h).data;
      const l = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) l[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      return l;
    };
    const a = await get(blobA), b = await get(blobB);
    const n = Math.min(a.length, b.length);
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 1;
  }

  // ---------------------------------------------------------------- 公開用の画像を作る
  // renditions: [{ key, spec, formats: [{ type: 'image/jpeg', quality: 0.82 }, …] }]
  // region: { x, y, w, h }（0〜1）… 人の顔・伝票などを外すために、写真の一部だけを使うとき
  // redactions: [{ x, y, w, h, method }]（0〜1・写真全体に対する位置）… 読み取れなくする部分
  // opts: { rotate: 角度（度）, enhance: true/false } … 傾きの修正・画質の補正（どちらも指定したときだけ）
  // 返す値の renditions[].redacted … 各画像の中で、処理した部分がどこにあるか（0〜1）と、残った模様の測定値
  //         quality … 画質の補正の前後の測定値（補正しなかったときは理由）
  async function process(blob, renditions, region, redactions, opts) {
    opts = opts || {};
    redactions = redactions || [];
    const bmp0 = await loadBitmap(blob);
    const source = { width: bmp0.width, height: bmp0.height };
    let src = bmp0;
    let mapRect = (q) => q;
    const finish = !!(opts.rotate || opts.enhance);
    // 仕上げをするときは、作業用に長い辺2560pxまで縮める（公開用の画像は最大2048px）
    if (finish && Math.max(src.width, src.height) > 2560) {
      const s = 2560 / Math.max(src.width, src.height);
      src = canvasOf(src, Math.round(src.width * s), Math.round(src.height * s));
    }
    if (redactions.length) src = redact(src, redactions);
    if (opts.rotate) {
      if (Math.abs(opts.rotate) > 8) throw new Error('傾きの修正は8度までです。');
      const r = rotate(src, opts.rotate);
      src = r.canvas;
      mapRect = r.mapRect;
    }
    const mapped = redactions.map(mapRect);
    let quality = null;
    if (opts.enhance) {
      if (!(src instanceof HTMLCanvasElement)) src = canvasOf(src);
      // 処理した部分（塗りつぶし・ぼかし）は、画質の計算から除く
      const ex = mapped.map((q) => ({ x0: q.x * src.width, y0: q.y * src.height, x1: (q.x + q.w) * src.width, y1: (q.y + q.h) * src.height }));
      quality = enhance(src, ex);
    }
    const W = src.width, H = src.height;
    const rg = region || { x: 0, y: 0, w: 1, h: 1 };
    const rx = Math.round(W * rg.x);
    const ry = Math.round(H * rg.y);
    const rw = Math.round(W * rg.w);
    const rh = Math.round(H * rg.h);
    const out = [];
    for (const r of renditions) {
      const l = layout(rw, rh, r.spec);
      l.sx += rx;
      l.sy += ry;
      const canvas = document.createElement('canvas');
      canvas.width = l.w;
      canvas.height = l.h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, l.w, l.h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, l.sx, l.sy, l.sw, l.sh, 0, 0, l.w, l.h);
      // 処理した部分が、この画像のどこに写っているか（切り抜きで外れた部分は除く）
      const redacted = mapped.map((q) => {
        if (!(q.w > 0 && q.h > 0)) return null;
        const x0 = Math.max(q.x * W, l.sx), y0 = Math.max(q.y * H, l.sy);
        const x1 = Math.min((q.x + q.w) * W, l.sx + l.sw), y1 = Math.min((q.y + q.h) * H, l.sy + l.sh);
        if (x1 <= x0 || y1 <= y0) return null;
        return { x: (x0 - l.sx) / l.sw, y: (y0 - l.sy) / l.sh, w: (x1 - x0) / l.sw, h: (y1 - y0) / l.sh, method: q.method || 'fill' };
      }).filter(Boolean);
      for (const f of r.formats) {
        const b = await toBlob(canvas, f.type, f.quality);
        // ブラウザがWebPの書き出しに対応していない場合は、PNGなど別の形式になるため使わない
        if (!b || b.type !== f.type) { out.push({ key: r.key, type: f.type, unsupported: true }); continue; }
        // できあがった公開用の画像を読み直し、処理した部分に細かい模様が残っていないかを測る
        const check = redacted.length ? await measure(b, redacted) : [];
        out.push({ key: r.key, type: b.type, width: l.w, height: l.h, bytes: b.size, redacted: redacted.map((q, i) => ({ ...q, ...check[i] })), base64: await blobToBase64(b) });
      }
    }
    bmp0.close();
    return { source, quality, rotate: opts.rotate || 0, renditions: out };
  }

  // _enhance … テスト用（補正で悪くなる写真は補正しない、を確かめる）
  global.OshismaPhoto = { process, layout, measure, redact, similarity, _enhance: enhance };
})(typeof window !== 'undefined' ? window : globalThis);

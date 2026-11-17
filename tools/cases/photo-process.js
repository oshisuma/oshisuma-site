// 公開用の写真を作るブラウザ用の処理（段階②）
// 同じ処理を、テスト（このパソコンのEdge）と、今後のスマホ確認ページの両方で使う。
// - スマホの写真の向き（EXIFの回転情報）を反映してから描き直す
// - 描き直すことで、位置情報（GPS）・撮影機器などの撮影情報はすべて消える
// - 元の写真は変更しない（新しい画像を作るだけ）
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

  // 個人情報などを読み取れなくする（写真の向きを直した後の、写真全体に対する 0〜1 の位置）
  //   method 'fill' … 塗りつぶし（文字・QRコード・番号・画面など。確実に読めなくする）
  //   method 'blur' … 強いモザイク＋ぼかし（背景の書類・人など、形が残ってもよいもの）
  // 公開用の画像は、すべてこの処理をした写真から作る（元の写真は変更しない）
  function redact(bmp, redactions) {
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
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
        // 周りの色に近い落ち着いた色で塗りつぶす（不自然に目立たせない）
        ctx.fillStyle = r.color || '#5f6368';
        ctx.fillRect(x, y, w, h);
      }
    }
    return c;
  }

  // 画像の決まった範囲に、細かい模様（文字・線）が残っていないかを測る（公開用の画像の確認用）
  // 返す値：edge … となりの点との明るさの差の平均（文字や線があると大きい）、std … 明るさのばらつき
  async function measure(blob, rects) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
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
      return { edge: n ? edge / n / 2 : 0, std: Math.sqrt(Math.max(0, sum2 / (w * h) - mean * mean)), pixels: w * h };
    });
    bmp.close();
    return out;
  }

  // renditions: [{ key, spec, formats: [{ type: 'image/jpeg', quality: 0.82 }, …] }]
  // region: { x, y, w, h }（0〜1）… 人の顔・伝票などを外すために、写真の一部だけを使うとき
  // redactions: [{ x, y, w, h, method }]（0〜1・写真全体に対する位置）… 読み取れなくする部分
  // 返す値の renditions[].redacted … 各画像の中で、処理した部分がどこにあるか（0〜1。確認に使う）
  async function process(blob, renditions, region, redactions) {
    const bmp0 = await loadBitmap(blob);
    const source = { width: bmp0.width, height: bmp0.height };
    const bmp = redactions && redactions.length ? redact(bmp0, redactions) : bmp0;
    const rg = region || { x: 0, y: 0, w: 1, h: 1 };
    const rx = Math.round(bmp.width * rg.x);
    const ry = Math.round(bmp.height * rg.y);
    const rw = Math.round(bmp.width * rg.w);
    const rh = Math.round(bmp.height * rg.h);
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
      ctx.drawImage(bmp, l.sx, l.sy, l.sw, l.sh, 0, 0, l.w, l.h);
      // 処理した部分が、この画像のどこに写っているか（切り抜きで外れた部分は除く）
      const redacted = (redactions || []).map((q) => {
        const x0 = Math.max(q.x * source.width, l.sx), y0 = Math.max(q.y * source.height, l.sy);
        const x1 = Math.min((q.x + q.w) * source.width, l.sx + l.sw), y1 = Math.min((q.y + q.h) * source.height, l.sy + l.sh);
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
    return { source, renditions: out };
  }

  global.OshismaPhoto = { process, layout, measure, redact };
})(typeof window !== 'undefined' ? window : globalThis);

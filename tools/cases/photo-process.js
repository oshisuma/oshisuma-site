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

  // renditions: [{ key, spec, formats: [{ type: 'image/jpeg', quality: 0.82 }, …] }]
  // region: { x, y, w, h }（0〜1）… 人の顔・伝票などを外すために、写真の一部だけを使うとき
  async function process(blob, renditions, region) {
    const bmp = await loadBitmap(blob);
    const source = { width: bmp.width, height: bmp.height };
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
      for (const f of r.formats) {
        const b = await toBlob(canvas, f.type, f.quality);
        // ブラウザがWebPの書き出しに対応していない場合は、PNGなど別の形式になるため使わない
        if (!b || b.type !== f.type) { out.push({ key: r.key, type: f.type, unsupported: true }); continue; }
        out.push({ key: r.key, type: b.type, width: l.w, height: l.h, bytes: b.size, base64: await blobToBase64(b) });
      }
    }
    bmp.close();
    return { source, renditions: out };
  }

  global.OshismaPhoto = { process, layout };
})(typeof window !== 'undefined' ? window : globalThis);

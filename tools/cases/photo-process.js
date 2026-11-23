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

  // マスクは撮影画像全体の0..1座標で指定し、常に不透明の塗りつぶしにする。
  // ぼかしだけではQRや番号を復元できる場合があるため、識別情報には塗りつぶしを優先。
  // 入力座標が不正なら公開用画像の生成を中断する（加工漏れを作らない）。
  function maskRect(sourceWidth, sourceHeight, crop, layoutValue, mask) {
    const vals = [mask.x, mask.y, mask.w, mask.h];
    if (!vals.every(v => typeof v === 'number' && Number.isFinite(v)) ||
        mask.w <= 0 || mask.h <= 0 ||
        mask.x < 0 || mask.y < 0 || mask.x + mask.w > 1 || mask.y + mask.h > 1) {
      throw new Error('個人情報マスクの範囲が不正です');
    }
    const mx = mask.x * sourceWidth;
    const my = mask.y * sourceHeight;
    const mw = mask.w * sourceWidth;
    const mh = mask.h * sourceHeight;
    const sx = Math.max(mx, layoutValue.sx);
    const sy = Math.max(my, layoutValue.sy);
    const ex = Math.min(mx + mw, layoutValue.sx + layoutValue.sw);
    const ey = Math.min(my + mh, layoutValue.sy + layoutValue.sh);
    if (ex <= sx || ey <= sy) return null;
    return {
      x: (sx - layoutValue.sx) * layoutValue.w / layoutValue.sw,
      y: (sy - layoutValue.sy) * layoutValue.h / layoutValue.sh,
      w: (ex - sx) * layoutValue.w / layoutValue.sw,
      h: (ey - sy) * layoutValue.h / layoutValue.sh
    };
  }
  function safeTone(tone) {
    if (!tone) return { brightness: 1, contrast: 1, saturation: 1 };
    const vals = [tone.brightness, tone.contrast, tone.saturation];
    if (!vals.every(v => typeof v === 'number' && Number.isFinite(v)))
      throw new Error('写真補正値が不正です');
    // 自然な写真補正の範囲のみ許可。破損や傷を消すための生成的編集はしない。
    if (tone.brightness < 0.9 || tone.brightness > 1.1 ||
        tone.contrast < 0.9 || tone.contrast > 1.1 ||
        tone.saturation < 0.92 || tone.saturation > 1.08)
      throw new Error('写真補正値が強すぎます');
    return tone;
  }

  // renditions: [{ key, spec, formats: [{ type: 'image/jpeg', quality: 0.82 }, …] }]
  // region: { x, y, w, h }（0〜1）… 人の顔・伝票などを外すために、写真の一部だけを使うとき
  async function process(blob, renditions, region, options) {
    const opts = options || {};
    const masks = Array.isArray(opts.masks) ? opts.masks : [];
    if (masks.length > 25) throw new Error('個人情報マスクが多すぎます');
    const tone = safeTone(opts.tone || null);
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
      ctx.filter = 'brightness(' + tone.brightness + ') contrast(' + tone.contrast +
        ') saturate(' + tone.saturation + ')';
      ctx.drawImage(bmp, l.sx, l.sy, l.sw, l.sh, 0, 0, l.w, l.h);
      ctx.filter = 'none';
      ctx.fillStyle = '#1f2937';
      for (const mask of masks) {
        const rect = maskRect(bmp.width, bmp.height, rg, l, mask);
        if (rect) ctx.fillRect(Math.floor(rect.x), Math.floor(rect.y),
          Math.ceil(rect.w + 1), Math.ceil(rect.h + 1));
      }
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

  global.OshismaPhoto = { process, layout, maskRect, safeTone };
})(typeof window !== 'undefined' ? window : globalThis);

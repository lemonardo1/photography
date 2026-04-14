/**
 * colorpicker.js
 * 이미지에서 Canvas를 통해 픽셀을 샘플링하고
 * k-means++ 클러스터링으로 주요 색상 k개를 추출합니다.
 * 각 색상의 이미지 내 평균 위치(pos: [nx, ny], 0~1 정규화)도 반환합니다.
 */

const ColorPicker = (() => {

  /* ── 픽셀 샘플링 ─────────────────────────────────────────── */
  // 반환: [[r, g, b, nx, ny], ...] — 마지막 두 원소는 정규화된 픽셀 좌표
  function samplePixels(img, maxDim = 180) {
    const canvas = document.createElement('canvas');
    const scale  = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    canvas.width  = Math.max(1, Math.round((img.naturalWidth  || img.width)  * scale));
    canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const data   = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const pixels = [];
    const step   = Math.max(1, Math.floor(data.length / (3000 * 4)));
    const wm1    = (canvas.width  - 1) || 1;
    const hm1    = (canvas.height - 1) || 1;

    for (let i = 0; i < data.length; i += 4 * step) {
      const a = data[i + 3];
      if (a < 200) continue;          // 반투명 픽셀 제외
      const r = data[i], g = data[i+1], b = data[i+2];
      // 거의 흰색/검정 제외 (사진 테두리 noise 방지)
      if (r > 245 && g > 245 && b > 245) continue;
      if (r < 10  && g < 10  && b < 10)  continue;
      const idx = i / 4;
      const nx  = (idx % canvas.width)           / wm1;
      const ny  = Math.floor(idx / canvas.width) / hm1;
      pixels.push([r, g, b, nx, ny]);
    }
    return pixels;
  }

  /* ── 색상 거리 (RGB 3채널만) ─────────────────────────────── */
  function dist2(a, b) {
    return (a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2;
  }

  /* ── k-means++ 초기화 ────────────────────────────────────── */
  function initCentroids(pixels, k) {
    const centroids = [pixels[Math.floor(Math.random() * pixels.length)]];
    for (let c = 1; c < k; c++) {
      const dists = pixels.map(p => Math.min(...centroids.map(ct => dist2(p, ct))));
      const total = dists.reduce((s, d) => s + d, 0);
      let r = Math.random() * total;
      for (let i = 0; i < dists.length; i++) {
        r -= dists[i];
        if (r <= 0) { centroids.push(pixels[i]); break; }
      }
      if (centroids.length < c + 1) centroids.push(pixels[pixels.length - 1]);
    }
    return centroids;
  }

  /* ── k-means 클러스터링 ──────────────────────────────────── */
  function kMeans(pixels, k = 5, maxIter = 25) {
    if (pixels.length <= k) {
      return pixels.map(p => ({
        color:  [p[0], p[1], p[2]],
        pos:    [p[3], p[4]],
        weight: 1 / pixels.length,
      }));
    }

    let centroids   = initCentroids(pixels, k);
    let assignments = new Int32Array(pixels.length);

    for (let iter = 0; iter < maxIter; iter++) {
      let moved = false;

      // 할당
      for (let i = 0; i < pixels.length; i++) {
        let best = 0, bestD = Infinity;
        for (let c = 0; c < k; c++) {
          const d = dist2(pixels[i], centroids[c]);
          if (d < bestD) { bestD = d; best = c; }
        }
        if (assignments[i] !== best) { assignments[i] = best; moved = true; }
      }
      if (!moved) break;

      // 중심 갱신 (RGB만 — 위치는 수렴 후 별도 계산)
      const sums   = Array.from({ length: k }, () => [0, 0, 0]);
      const counts = new Int32Array(k);
      for (let i = 0; i < pixels.length; i++) {
        const c = assignments[i];
        sums[c][0] += pixels[i][0];
        sums[c][1] += pixels[i][1];
        sums[c][2] += pixels[i][2];
        counts[c]++;
      }
      centroids = sums.map((s, c) =>
        counts[c] > 0
          ? [
              Math.round(s[0]/counts[c]),
              Math.round(s[1]/counts[c]),
              Math.round(s[2]/counts[c]),
            ]
          : centroids[c]
      );
    }

    const counts = new Int32Array(k);
    for (let i = 0; i < pixels.length; i++) counts[assignments[i]]++;

    return centroids
      .map((ct, c) => {
        // 평균 위치(centroid) 대신, 클러스터 내에서 색상이 centroid에
        // 가장 가까운 실제 픽셀의 위치를 사용 → 해당 색이 실제로 존재하는 곳을 가리킴
        let bestPos = [ct[3] ?? 0.5, ct[4] ?? 0.5];
        let bestDist = Infinity;
        for (let j = 0; j < pixels.length; j++) {
          if (assignments[j] !== c) continue;
          const d = dist2(pixels[j], ct);
          if (d < bestDist) { bestDist = d; bestPos = [pixels[j][3], pixels[j][4]]; }
        }
        return {
          color:  [ct[0], ct[1], ct[2]],
          pos:    bestPos,
          weight: counts[c] / pixels.length,
        };
      })
      .sort((a, b) => b.weight - a.weight);
  }

  /* ── 유틸 ────────────────────────────────────────────────── */
  function toHex([r, g, b]) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function luminance([r, g, b]) {
    // perceptual
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  // RGB → HSL (색상 정렬용)
  function toHsl([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default:h = (r - g) / d + 4;
    }
    return [h / 6, s, l];
  }

  /* ── 공개 API ────────────────────────────────────────────── */
  return {
    /**
     * @param {HTMLImageElement} img - 완전히 로드된 img 엘리먼트
     * @param {number} k - 색상 개수 (기본 5)
     * @returns {{ hex, rgb, weight, pos, lum, hsl }[]}
     *   pos: [nx, ny] — 이미지 내 정규화된 위치 (0~1)
     */
    extract(img, k = 5) {
      const pixels = samplePixels(img);
      if (!pixels.length) return [];
      const clusters = kMeans(pixels, k);
      return clusters.map(({ color, weight, pos }) => ({
        hex:    toHex(color),
        rgb:    color,
        weight,
        pos,
        lum:    luminance(color),
        hsl:    toHsl(color),
      }));
    },

    toHex,
    luminance,
  };
})();

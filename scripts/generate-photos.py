#!/usr/bin/env python3
"""
generate-photos.py
──────────────────
photos/ 디렉토리의 이미지를 스캔해 EXIF 메타데이터를 읽고
js/photos.js 를 자동으로 생성합니다.

사용법:
  python3 scripts/generate-photos.py

옵션:
  --src   스캔할 디렉토리 (기본: photos/)
  --out   출력 파일    (기본: js/photos.js)
  --keep  기존 photos.js의 수동 설정(title, category) 유지
"""

import json
import os
import re
import subprocess
import sys
import argparse
from pathlib import Path
from datetime import datetime

# ── 설정 ────────────────────────────────────────────────────────────────────
SUPPORTED_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.heic'}
MAX_SIZE_MB   = 10          # 이보다 크면 웹용 원본으로 간주, 제외
SCRIPT_DIR    = Path(__file__).parent
PROJECT_DIR   = SCRIPT_DIR.parent
DEFAULT_SRC   = PROJECT_DIR / 'photos'
DEFAULT_OUT   = PROJECT_DIR / 'js' / 'photos.js'

# ── 카메라 모델 코드 → 표시 이름 ─────────────────────────────────────────────
CAMERA_MODELS = {
    # Sony Alpha
    'ILCE-7RM4':  'Sony A7R IV',
    'ILCE-7RM4A': 'Sony A7R IVA',
    'ILCE-7RM5':  'Sony A7R V',
    'ILCE-7RM3':  'Sony A7R III',
    'ILCE-7RM3A': 'Sony A7R IIIA',
    'ILCE-7M4':   'Sony A7 IV',
    'ILCE-7M3':   'Sony A7 III',
    'ILCE-7SM3':  'Sony A7S III',
    'ILCE-7C':    'Sony A7C',
    'ILCE-7CR':   'Sony A7CR',
    'ILCE-1':     'Sony A1',
    'ILCE-9M3':   'Sony A9 III',
    'ZV-E1':      'Sony ZV-E1',
    # Fujifilm
    'X-T5':       'Fujifilm X-T5',
    'X-T4':       'Fujifilm X-T4',
    'X100VI':     'Fujifilm X100VI',
    'X100V':      'Fujifilm X100V',
    # Nikon
    'Z 8':        'Nikon Z8',
    'Z 9':        'Nikon Z9',
    'Z 6_2':      'Nikon Z6II',
    'Z 7_2':      'Nikon Z7II',
    # Canon
    'Canon EOS R5':  'Canon EOS R5',
    'Canon EOS R6':  'Canon EOS R6',
}

# ── 카테고리 키워드 자동 매핑 (파일명 기준 보조 힌트) ────────────────────────
CATEGORY_HINTS = {
    'landscape': ['mountain', 'sky', 'sea', 'ocean', 'lake', 'forest', 'sunset', 'sunrise',
                  '산', '하늘', '바다', '호수', '숲', '노을'],
    'portrait':  ['portrait', 'face', 'person', '인물', '셀카'],
    'street':    ['street', 'city', 'urban', 'rain', '도시', '거리', '비'],
    'nature':    ['flower', 'plant', 'tree', 'insect', 'bird', '꽃', '식물', '나무', '새'],
}

def guess_category(filename: str, width: int, height: int) -> str:
    lower = filename.lower()
    for cat, keywords in CATEGORY_HINTS.items():
        if any(k in lower for k in keywords):
            return cat
    return 'landscape'   # 기본값

def aspect_hint(width: int, height: int) -> str:
    if width == 0 or height == 0:
        return 'landscape'
    ratio = width / height
    if ratio >= 1.15:
        return 'landscape'
    elif ratio <= 0.87:
        return 'portrait'
    return 'square'

def fmt_shutter(exposure: str) -> str:
    """'0.001' → '1/1000'  or pass-through if already fraction"""
    if not exposure or '/' in str(exposure):
        return str(exposure)
    try:
        val = float(exposure)
        if val < 1:
            denom = round(1 / val)
            return f'1/{denom}'
        return f'{val:.1f}s'
    except ValueError:
        return str(exposure)

def friendly_model(raw: str) -> str:
    return CAMERA_MODELS.get(raw.strip(), raw.strip())

def build_info(exif: dict) -> str:
    parts = []
    ap  = exif.get('Aperture', '')
    ss  = fmt_shutter(exif.get('ExposureTime', ''))
    iso = exif.get('ISO', '')

    if ap:  parts.append(f'f/{ap}')
    if ss:  parts.append(str(ss))
    if iso: parts.append(f'ISO {iso}')

    return ' · '.join(parts)

def load_existing(out_path: Path) -> dict:
    """기존 photos.js에서 파일명 → {title, category} 맵 추출"""
    if not out_path.exists():
        return {}
    content = out_path.read_text(encoding='utf-8')
    # src 필드 기준으로 매칭
    entries = {}
    pattern = re.findall(
        r'\{[^}]*?src:\s*[\'"]([^\'"]+)[\'"][^}]*?\}',
        content, re.DOTALL
    )
    # 더 정확하게 파싱
    block_re = re.compile(r'\{([^{}]+?)\}', re.DOTALL)
    for block in block_re.finditer(content):
        b = block.group(1)
        src_m   = re.search(r"src:\s*['\"]([^'\"]+)['\"]", b)
        title_m = re.search(r"title:\s*['\"]([^'\"]+)['\"]", b)
        cat_m   = re.search(r"category:\s*['\"]([^'\"]+)['\"]", b)
        if src_m:
            fname = Path(src_m.group(1)).name
            entries[fname] = {
                'title':    title_m.group(1) if title_m else '',
                'category': cat_m.group(1)   if cat_m   else '',
            }
    return entries

def scan_photos(src_dir: Path, existing: dict) -> list:
    files = sorted(
        [f for f in src_dir.iterdir()
         if f.is_file() and f.suffix.lower() in SUPPORTED_EXT],
        key=lambda f: f.stat().st_mtime
    )

    # 크기 필터
    web_files = []
    for f in files:
        size_mb = f.stat().st_size / 1024 / 1024
        if size_mb > MAX_SIZE_MB:
            print(f'  skip (too large {size_mb:.1f}MB): {f.name}')
            continue
        web_files.append(f)

    if not web_files:
        print('  사진 파일이 없습니다.')
        return []

    # exiftool 일괄 호출 (WebP)
    paths = [str(f) for f in web_files]
    result = subprocess.run(
        ['exiftool', '-json', '-q',
         '-Make', '-Model', '-LensModel',
         '-FocalLength', '-Aperture', '-ExposureTime', '-ISO',
         '-ImageWidth', '-ImageHeight', '-DateTimeOriginal',
         *paths],
        capture_output=True, text=True
    )

    try:
        exif_list = json.loads(result.stdout)
    except json.JSONDecodeError:
        exif_list = []

    exif_map = {Path(e['SourceFile']).name: e for e in exif_list}

    # originals/ 폴백 — WebP에 EXIF 없는 경우 원본에서 보완
    originals_dir = src_dir / 'originals'
    if originals_dir.exists():
        orig_exts = {'.jpg', '.jpeg', '.png', '.heic'}
        orig_files = [f for f in originals_dir.iterdir()
                      if f.suffix.lower() in orig_exts]
        if orig_files:
            orig_result = subprocess.run(
                ['exiftool', '-json', '-q',
                 '-Make', '-Model', '-LensModel',
                 '-FocalLength', '-Aperture', '-ExposureTime', '-ISO',
                 '-DateTimeOriginal',
                 *[str(f) for f in orig_files]],
                capture_output=True, text=True
            )
            try:
                orig_list = json.loads(orig_result.stdout)
            except json.JSONDecodeError:
                orig_list = []
            # stem 기준으로 매핑 (DSC07025.jpg → DSC07025.webp)
            orig_exif_map = {Path(e['SourceFile']).stem: e for e in orig_list}
            for webp_name, exif in exif_map.items():
                stem = Path(webp_name).stem
                if not exif.get('Aperture') and stem in orig_exif_map:
                    orig = orig_exif_map[stem]
                    for key in ('Aperture', 'ExposureTime', 'ISO',
                                'Model', 'LensModel', 'FocalLength',
                                'DateTimeOriginal'):
                        if orig.get(key):
                            exif[key] = orig[key]
            # WebP에 아예 없던 파일도 originals로 채우기
            for f in web_files:
                if f.name not in exif_map:
                    continue
                stem = f.stem
                if not exif_map[f.name].get('Aperture') and stem in orig_exif_map:
                    orig = orig_exif_map[stem]
                    for key in ('Aperture', 'ExposureTime', 'ISO',
                                'Model', 'LensModel', 'FocalLength',
                                'DateTimeOriginal',
                                'ImageWidth', 'ImageHeight'):
                        if orig.get(key):
                            exif_map[f.name][key] = orig[key]

    photos = []
    for f in web_files:
        exif = exif_map.get(f.name, {})
        w = exif.get('ImageWidth', 0)
        h = exif.get('ImageHeight', 0)

        prev = existing.get(f.name, {})

        # 날짜 파싱
        date_raw = exif.get('DateTimeOriginal', '')
        try:
            dt = datetime.strptime(date_raw, '%Y:%m:%d %H:%M:%S')
            date_str = dt.strftime('%Y.%m.%d')
        except Exception:
            date_str = ''

        # 파일명에서 기본 제목 생성 (DSC/IMG 번호 → 날짜 기반 제목)
        stem = Path(f.name).stem
        auto_title = stem.replace('_', ' ').replace('-2', '').strip()

        photos.append({
            'src':      f'photos/{f.name}',
            'title':    prev.get('title') or auto_title,
            'category': prev.get('category') or guess_category(f.name, w, h),
            'info':     build_info(exif),
            'date':     date_str,
            'aspect':   aspect_hint(w, h),
            'width':    w,
            'height':   h,
        })

    return photos

# ── 색상 흐름 정렬 ──────────────────────────────────────────────────────────

def _linearize(c: float) -> float:
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def rgb_to_lab(r: float, g: float, b: float) -> tuple:
    """sRGB → CIE L*a*b* (D65)"""
    rl, gl, bl = _linearize(r), _linearize(g), _linearize(b)
    X = rl * 0.4124 + gl * 0.3576 + bl * 0.1805
    Y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722
    Z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505
    def f(t):
        return t ** (1/3) if t > (6/29)**3 else t / (3 * (6/29)**2) + 4/29
    L  = 116 * f(Y / 1.0000) - 16
    a  = 500 * (f(X / 0.9505) - f(Y / 1.0000))
    bv = 200 * (f(Y / 1.0000) - f(Z / 1.0890))
    return (L, a, bv)

def dominant_lab(img_path: Path) -> tuple:
    """이미지의 대표 색상을 Lab으로 반환. 극단 픽셀(흰/검)은 제외."""
    try:
        from PIL import Image
        img = Image.open(img_path).convert('RGB')
        img.thumbnail((120, 120))
        pixels   = list(img.getdata())
        filtered = [(r, g, b) for r, g, b in pixels
                    if not (r > 245 and g > 245 and b > 245)
                    and not (r < 10  and g < 10  and b < 10)]
        if not filtered:
            filtered = pixels
        n  = len(filtered)
        ar = sum(p[0] for p in filtered) / n
        ag = sum(p[1] for p in filtered) / n
        ab = sum(p[2] for p in filtered) / n
        return rgb_to_lab(ar, ag, ab)
    except Exception as e:
        print(f'    색상 추출 실패 ({img_path.name}): {e}')
        return (50.0, 0.0, 0.0)   # 중간 회색 fallback

def sort_by_color_flow(photos: list, src_dir: Path) -> list:
    """Greedy nearest-neighbor TSP in Lab space — 색이 비슷한 사진끼리 이웃."""
    if len(photos) <= 2:
        return photos

    print('  색상 분석 중…')
    labs = []
    for p in photos:
        img_path = src_dir / Path(p['src']).name
        lab = dominant_lab(img_path)
        labs.append(lab)
        print(f'    {Path(p["src"]).name:<30} Lab({lab[0]:5.1f}, {lab[1]:5.1f}, {lab[2]:5.1f})')

    n       = len(photos)
    visited = [False] * n
    # 가장 밝은 사진을 시작점으로 (L이 가장 큰 것)
    start   = max(range(n), key=lambda i: labs[i][0])
    order   = [start]
    visited[start] = True

    for _ in range(n - 1):
        cur  = order[-1]
        cL, ca, cb = labs[cur]
        best, best_d = -1, float('inf')
        for j in range(n):
            if visited[j]:
                continue
            dL = cL - labs[j][0]
            da = ca - labs[j][1]
            db = cb - labs[j][2]
            d  = dL*dL + da*da + db*db
            if d < best_d:
                best_d, best = d, j
        order.append(best)
        visited[best] = True

    print(f'  색상 흐름 정렬 완료 ({n}장)')
    return [photos[i] for i in order]


def write_photos_js(photos: list, out_path: Path):
    lines = [
        '/**',
        ' * photos.js — 자동 생성됨 (generate-photos.py)',
        f' * 생성일시: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}',
        ' *',
        ' * 수동으로 title, category 를 수정해도',
        ' * --keep 옵션으로 다음 생성 시 유지됩니다.',
        ' *',
        ' * category: "landscape" | "portrait" | "street" | "nature"',
        ' * aspect:   "landscape" | "portrait" | "square"',
        ' * 정렬:     색상 흐름 (Lab nearest-neighbor)',
        ' */',
        '',
        'window.PHOTOS = [',
    ]

    for p in photos:
        info_escaped = p['info'].replace("'", "\\'")
        title_escaped = p['title'].replace("'", "\\'")
        date_part = f"    date:     '{p['date']}',\n" if p['date'] else ''
        lines.append(
            f"  {{\n"
            f"    src:      '{p['src']}',\n"
            f"    title:    '{title_escaped}',\n"
            f"    category: '{p['category']}',\n"
            f"    info:     '{info_escaped}',\n"
            f"{date_part}"
            f"    aspect:   '{p['aspect']}',\n"
            f"  }},"
        )

    lines += ['];', '']
    out_path.write_text('\n'.join(lines), encoding='utf-8')
    print(f'  ✓ {out_path} 에 {len(photos)}개 사진 기록')

def main():
    parser = argparse.ArgumentParser(description='EXIF → photos.js 자동 생성')
    parser.add_argument('--src',  type=Path, default=DEFAULT_SRC, help='스캔 디렉토리')
    parser.add_argument('--out',  type=Path, default=DEFAULT_OUT, help='출력 파일')
    parser.add_argument('--keep', action='store_true', help='기존 title/category 유지')
    parser.add_argument('--sort', choices=['color', 'mtime'], default='color',
                        help='정렬 기준: color=색상 흐름(기본), mtime=파일 수정 시간')
    args = parser.parse_args()

    if not args.src.exists():
        print(f'ERROR: {args.src} 가 존재하지 않습니다.')
        sys.exit(1)

    print(f'스캔: {args.src}')
    existing = load_existing(args.out) if args.keep else {}
    photos   = scan_photos(args.src, existing)
    if photos:
        if args.sort == 'color':
            photos = sort_by_color_flow(photos, args.src)
        write_photos_js(photos, args.out)
        print(f'총 {len(photos)}개 사진 처리 완료.')

if __name__ == '__main__':
    main()

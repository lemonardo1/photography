#!/usr/bin/env python3
"""
optimize-images.py
──────────────────
photos/ 의 이미지를 WebP로 변환하고 최대 2400px로 리사이즈합니다.
원본은 photos/originals/ 에 보존되며, photos.js 경로도 자동 업데이트됩니다.

사용법:
  python3 scripts/optimize-images.py [--quality 82] [--max-dim 2400] [--dry-run]
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR  = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
PHOTOS_DIR  = PROJECT_DIR / 'photos'
ORIG_DIR    = PHOTOS_DIR / 'originals'
PHOTOS_JS   = PROJECT_DIR / 'js' / 'photos.js'

SUPPORTED = {'.jpg', '.jpeg', '.png', '.webp', '.heic'}


def get_dimensions(path: Path) -> tuple[int, int]:
    result = subprocess.run(
        ['python3', '-c',
         f'from PIL import Image; w,h=Image.open("{path}").size; print(w,h)'],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        w, h = result.stdout.strip().split()
        return int(w), int(h)
    return 0, 0


def convert(src: Path, dst: Path, quality: int, max_dim: int, dry_run: bool) -> tuple[int, int]:
    """WebP 변환 + 리사이즈. (원본 크기, 결과 크기) 반환."""
    orig_size = src.stat().st_size

    if dry_run:
        return orig_size, orig_size

    w, h = get_dimensions(src)
    scale = min(1.0, max_dim / max(w, h, 1))
    new_w = max(1, round(w * scale))
    new_h = max(1, round(h * scale))

    # cwebp 사용 (PNG/JPG → WebP)
    resize_flag = ['-resize', str(new_w), str(new_h)] if scale < 1.0 else []
    cmd = ['cwebp', '-q', str(quality), *resize_flag, str(src), '-o', str(dst)]
    result = subprocess.run(cmd, capture_output=True)

    if result.returncode != 0:
        # fallback: Pillow
        subprocess.run([
            'python3', '-c',
            f'''
from PIL import Image
img = Image.open("{src}").convert("RGB")
if {scale} < 1.0:
    img = img.resize(({new_w}, {new_h}), Image.LANCZOS)
img.save("{dst}", "WEBP", quality={quality}, method=6)
'''
        ], check=True)

    return orig_size, dst.stat().st_size


def update_photos_js(rename_map: dict[str, str]):
    """photos.js에서 src 경로를 WebP로 교체."""
    if not PHOTOS_JS.exists():
        return
    content = PHOTOS_JS.read_text(encoding='utf-8')
    for old, new in rename_map.items():
        content = content.replace(f"'{old}'", f"'{new}'")
        content = content.replace(f'"{old}"', f'"{new}"')
    PHOTOS_JS.write_text(content, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--quality',  type=int,   default=82,   help='WebP 품질 (기본 82)')
    parser.add_argument('--max-dim',  type=int,   default=2400, help='긴 쪽 최대 픽셀 (기본 2400)')
    parser.add_argument('--dry-run',  action='store_true',      help='실제 변환 없이 미리보기')
    args = parser.parse_args()

    files = sorted(f for f in PHOTOS_DIR.iterdir()
                   if f.is_file() and f.suffix.lower() in SUPPORTED
                   and f.suffix.lower() != '.webp')

    if not files:
        print('변환할 파일이 없습니다.')
        return

    if not args.dry_run:
        ORIG_DIR.mkdir(exist_ok=True)

    total_before = total_after = 0
    rename_map: dict[str, str] = {}

    print(f'\n{"파일":<35} {"전":>8} {"후":>8} {"절감":>7}')
    print('─' * 62)

    for src in files:
        dst_name = src.stem + '.webp'
        dst = PHOTOS_DIR / dst_name

        before, after = convert(src, dst, args.quality, args.max_dim, args.dry_run)
        saved_pct = (1 - after / before) * 100 if before else 0

        total_before += before
        total_after  += after

        old_src = f'photos/{src.name}'
        new_src = f'photos/{dst_name}'
        rename_map[old_src] = new_src

        marker = '(skip)' if args.dry_run else '✓'
        print(f'  {marker} {src.name:<32} {before/1024:>6.0f}K  {after/1024:>6.0f}K  -{saved_pct:>4.0f}%')

        if not args.dry_run and src != dst:
            # 원본 보존
            shutil.move(str(src), str(ORIG_DIR / src.name))

    print('─' * 62)
    total_saved = (1 - total_after / total_before) * 100 if total_before else 0
    print(f'  {"합계":<35} {total_before/1024/1024:>5.1f}MB  {total_after/1024/1024:>5.1f}MB  -{total_saved:.0f}%\n')

    if not args.dry_run:
        update_photos_js(rename_map)
        print(f'원본 보존 위치: {ORIG_DIR}')
        print(f'photos.js 경로 업데이트 완료')


if __name__ == '__main__':
    main()

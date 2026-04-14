#!/usr/bin/env python3
"""
import-photos.py
────────────────
temp 디렉토리에서 photos/ 로 웹 적합한 사진만 복사합니다.

규칙:
  - 10MB 초과 파일 제외 (원본 고해상도)
  - 같은 이름의 '-2' 쌍이 있을 때:
      · 두 파일 크기가 같으면 → 진짜 중복, -2 제외
      · 크기가 다르면 → -2 가 웹 익스포트 버전, 작은 파일 사용
  - 이미 photos/ 에 있으면 덮어쓰지 않음 (--force 로 강제)
"""

import shutil
import sys
import argparse
from pathlib import Path

SUPPORTED_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.heic'}
MAX_SIZE_MB   = 10
SCRIPT_DIR    = Path(__file__).parent
PROJECT_DIR   = SCRIPT_DIR.parent
DEFAULT_SRC   = PROJECT_DIR / 'temp'
DEFAULT_DST   = PROJECT_DIR / 'photos'

def get_size(p: Path) -> int:
    return p.stat().st_size

def collect(src_dir: Path) -> list[Path]:
    """src 디렉토리(재귀)에서 이미지 파일 수집"""
    files = []
    for f in sorted(src_dir.rglob('*')):
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXT:
            files.append(f)
    return files

def select_files(files: list[Path]) -> tuple[list[Path], list[tuple[Path, str]]]:
    """선택할 파일 목록과 제외 이유 반환"""
    # 이름 → Path 맵 (중복 쌍 탐지용)
    name_map: dict[str, Path] = {}
    for f in files:
        name_map[f.name] = f

    selected  = []
    skipped   = []

    processed = set()

    for f in files:
        if f in processed:
            continue

        size_mb = get_size(f) / 1024 / 1024

        # 대형 파일 제외
        if size_mb > MAX_SIZE_MB:
            # 하지만 -2 쌍이 있으면 그 쪽은 별도 처리됨
            skipped.append((f, f'too large ({size_mb:.1f}MB)'))
            processed.add(f)
            continue

        stem = f.stem
        ext  = f.suffix

        # '-2' 파일인지 확인
        if stem.endswith('-2'):
            base_stem = stem[:-2]
            base_name = base_stem + ext
            base_name_upper = base_stem + ext.upper()

            base_path = name_map.get(base_name) or name_map.get(base_name_upper)
            if base_path and base_path not in processed:
                base_mb = get_size(base_path) / 1024 / 1024
                if base_mb > MAX_SIZE_MB:
                    # 원본이 대용량 → -2 가 웹 익스포트, 선택
                    selected.append(f)
                    skipped.append((base_path, f'large original, using -{2} version ({size_mb:.1f}MB)'))
                    processed.add(base_path)
                    processed.add(f)
                elif get_size(f) == get_size(base_path):
                    # 동일 크기 → 진짜 중복, -2 제외
                    skipped.append((f, 'duplicate of same-size original'))
                    processed.add(f)
                else:
                    # 둘 다 적당한 크기 → 둘 다 포함
                    selected.append(f)
                    processed.add(f)
            else:
                selected.append(f)
                processed.add(f)
        else:
            selected.append(f)
            processed.add(f)

    return selected, skipped

def safe_filename(p: Path) -> str:
    """공백·특수문자 → 언더스코어"""
    name = p.name
    # 공백 제거
    name = name.replace(' ', '_')
    # 한글 등 유니코드는 그대로 유지 (브라우저에서 문제없음)
    return name

def copy_files(files: list[Path], dst_dir: Path, force: bool):
    dst_dir.mkdir(parents=True, exist_ok=True)
    copied  = []
    existed = []
    for f in files:
        dest_name = safe_filename(f)
        dest = dst_dir / dest_name
        if dest.exists() and not force:
            existed.append(dest_name)
            continue
        shutil.copy2(f, dest)
        copied.append(dest_name)
        print(f'  → {dest_name}')
    return copied, existed

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--src',   type=Path, default=DEFAULT_SRC)
    parser.add_argument('--dst',   type=Path, default=DEFAULT_DST)
    parser.add_argument('--force', action='store_true', help='이미 있는 파일도 덮어쓰기')
    args = parser.parse_args()

    if not args.src.exists():
        print(f'ERROR: {args.src} 없음'); sys.exit(1)

    print(f'\n[ 스캔 ] {args.src}\n')
    all_files = collect(args.src)
    selected, skipped = select_files(all_files)

    print('[ 제외 파일 ]')
    for f, reason in skipped:
        print(f'  ✗ {f.name}  ({reason})')

    print(f'\n[ 복사 → {args.dst} ]')
    copied, existed = copy_files(selected, args.dst, args.force)

    print(f'\n완료: {len(copied)}개 복사, {len(existed)}개 이미 존재 (skip)')
    if existed:
        print('  기존 파일:', ', '.join(existed[:5]), '...' if len(existed) > 5 else '')

if __name__ == '__main__':
    main()

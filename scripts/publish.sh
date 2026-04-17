#!/usr/bin/env bash
# publish.sh — 사진 추가부터 배포까지 원스텝 파이프라인
#
# 사용법:
#   bash scripts/publish.sh              # temp/ 의 사진을 가져와 전체 파이프라인 실행
#   bash scripts/publish.sh --no-deploy  # 배포 제외 (로컬 미리보기용)
#   bash scripts/publish.sh --skip-temp  # temp/ import 건너뜀 (photos/ 에 이미 넣어둔 경우)
#
# 단계:
#   1. temp/ → photos/  (import-photos.py)
#   2. JPG/PNG/HEIC → WebP + 리사이즈  (optimize-images.py)
#   3. EXIF 읽기 + 색상 흐름 정렬 → js/photos.js  (generate-photos.py)
#   4. git commit
#   5. wrangler pages deploy
#   6. temp/ 비우기

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 옵션 파싱 ─────────────────────────────────────────────────
NO_DEPLOY=false
SKIP_TEMP=false
for arg in "$@"; do
  case $arg in
    --no-deploy)  NO_DEPLOY=true ;;
    --skip-temp)  SKIP_TEMP=true ;;
    --help|-h)
      sed -n '2,15p' "$0" | sed 's/^#//'
      exit 0
      ;;
  esac
done

# ── 색상 출력 헬퍼 ─────────────────────────────────────────────
bold=$'\e[1m'; reset=$'\e[0m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; blue=$'\e[34m'
step() { echo; echo "${bold}${blue}▶ $*${reset}"; }
ok()   { echo "${green}  ✓ $*${reset}"; }
warn() { echo "${yellow}  ! $*${reset}"; }
fail() { echo "${red}  ✗ $*${reset}"; exit 1; }

cd "$PROJECT_DIR"

# ── 의존 도구 확인 ─────────────────────────────────────────────
step "의존 도구 확인"
for cmd in python3 exiftool wrangler; do
  command -v "$cmd" &>/dev/null && ok "$cmd" || fail "$cmd 가 없습니다. README의 의존 도구 항목을 확인하세요."
done
python3 -c "from PIL import Image" 2>/dev/null && ok "Pillow" || fail "Pillow 없음: pip install Pillow"

# ── 1. temp/ → photos/ ────────────────────────────────────────
if [ "$SKIP_TEMP" = false ]; then
  step "1/5  temp/ → photos/ 가져오기"
  TEMP_COUNT=$(find temp/ -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' -o -iname '*.heic' \) 2>/dev/null | wc -l | tr -d ' ')
  if [ "$TEMP_COUNT" -eq 0 ]; then
    warn "temp/ 에 가져올 파일이 없습니다. --skip-temp 와 동일하게 진행합니다."
  else
    echo "  temp/ 파일 ${TEMP_COUNT}개 발견"
    python3 scripts/import-photos.py
  fi
else
  warn "1/5  temp/ import 건너뜀 (--skip-temp)"
fi

# ── 2. WebP 변환 ───────────────────────────────────────────────
step "2/5  WebP 변환 + 리사이즈"
TO_CONVERT=$(find photos/ -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.heic' \) 2>/dev/null | wc -l | tr -d ' ')
if [ "$TO_CONVERT" -eq 0 ]; then
  warn "변환할 파일 없음 (이미 모두 WebP)"
else
  echo "  변환 대상: ${TO_CONVERT}개"
  python3 scripts/optimize-images.py
fi

# ── 3. photos.js 재생성 ────────────────────────────────────────
step "3/5  EXIF 분석 + 색상 흐름 정렬 → js/photos.js"
python3 scripts/generate-photos.py --keep
PHOTO_COUNT=$(find photos/ -maxdepth 1 -name '*.webp' | wc -l | tr -d ' ')
ok "총 ${PHOTO_COUNT}장 처리 완료"

# ── 4. git commit ──────────────────────────────────────────────
step "4/5  git commit"
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard photos/ js/photos.js)" ]; then
  warn "변경 사항 없음 — commit 건너뜀"
else
  git add photos/*.webp js/photos.js 2>/dev/null || true
  ADDED=$(git diff --cached --name-only | wc -l | tr -d ' ')
  COMMIT_MSG="Add photos: $(date '+%Y-%m-%d') (${PHOTO_COUNT}장)"
  git commit -m "$COMMIT_MSG"
  ok "commit 완료 ($ADDED 파일)"
fi

# ── 5. 배포 ────────────────────────────────────────────────────
if [ "$NO_DEPLOY" = false ]; then
  step "5/5  Cloudflare Pages 배포"
  wrangler pages deploy . --project-name photography
  ok "배포 완료 → https://photography-9zb.pages.dev"
else
  warn "5/5  배포 건너뜀 (--no-deploy)"
fi

# ── 6. temp/ 정리 ─────────────────────────────────────────────
if [ "$SKIP_TEMP" = false ]; then
  LEFTOVER=$(find temp/ -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$LEFTOVER" -gt 0 ]; then
    step "temp/ 정리"
    find temp/ -maxdepth 1 -type f -delete
    ok "temp/ 비움 ($LEFTOVER 개 삭제)"
  fi
fi

echo
echo "${bold}${green}파이프라인 완료.${reset}"

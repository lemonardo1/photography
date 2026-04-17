# Photography

Daeseong Kim의 개인 사진 갤러리. 바닐라 HTML/CSS/JS로 구현되어 Cloudflare Pages에 배포됩니다.

**배포 URL**: https://photography-9zb.pages.dev  
**GitHub**: https://github.com/lemonardo1/photography

---

## 목차

- [빠른 시작 — 사진 추가](#빠른-시작--사진-추가)
- [디렉토리 구조](#디렉토리-구조)
- [파이프라인 상세](#파이프라인-상세)
- [페이지 구조](#페이지-구조)
- [기능](#기능)
- [의존 도구 설치](#의존-도구-설치)

---

## 빠른 시작 — 사진 추가

```
1. 사진 파일을 temp/ 폴더에 복사
2. bash scripts/publish.sh
```

끝. 이후 모든 과정은 자동입니다.

```
temp/ 가져오기
  → JPG/PNG/HEIC → WebP 변환 + 2400px 리사이즈
  → EXIF 읽기 + 색상 흐름 정렬 → js/photos.js 재생성
  → git commit
  → Cloudflare Pages 배포
  → temp/ 자동 비움
```

### 옵션

| 명령 | 설명 |
|------|------|
| `bash scripts/publish.sh` | 전체 파이프라인 (기본) |
| `bash scripts/publish.sh --no-deploy` | 배포 제외 — 로컬에서 결과 먼저 확인할 때 |
| `bash scripts/publish.sh --skip-temp` | temp/ import 건너뜀 — `photos/`에 직접 넣은 경우 |

### 주의 사항

- **10MB 초과** 파일은 자동 제외됩니다 (고해상도 원본 보호). 10MB 넘는 파일을 올리려면 먼저 리사이즈하거나 `photos/`에 직접 넣고 `--skip-temp`를 사용하세요.
- **같은 이름의 파일**이 `photos/`에 이미 있으면 덮어쓰지 않습니다.
- `title`과 `category`를 수동으로 편집한 경우 `--keep` 옵션이 적용되어 다음 실행 시 유지됩니다.

---

## 디렉토리 구조

```
photography/
├── index.html                   # 단일 HTML 진입점
├── wrangler.toml                # Cloudflare Pages 배포 설정
├── css/
│   └── style.css                # 전체 스타일 (다크 테마, 레이아웃, 애니메이션)
├── js/
│   ├── main.js                  # 갤러리 · 라이트박스 · 필터 · 키보드/터치
│   ├── colorpicker.js           # k-means++ 색상 팔레트 추출
│   └── photos.js                # 자동 생성 — 사진 메타데이터 배열
├── photos/                      # WebP 이미지 (최대 2400px)
│   └── originals/               # 변환 전 원본 보존 (git 제외)
├── temp/                        # 새 사진을 여기 넣고 publish.sh 실행
└── scripts/
    ├── publish.sh               # 원스텝 파이프라인 (import → WebP → photos.js → 배포)
    ├── import-photos.py         # temp/ → photos/ 복사 및 정리
    ├── optimize-images.py       # JPG/PNG/HEIC → WebP 변환 + 리사이즈
    └── generate-photos.py       # EXIF 읽기 + 색상 정렬 → js/photos.js 생성
```

---

## 파이프라인 상세

단계별로 직접 실행할 때의 참고 문서입니다. 보통은 `publish.sh`를 사용하세요.

### 1단계 — temp/ 가져오기

```bash
python3 scripts/import-photos.py
```

- `temp/` 하위 파일을 재귀 스캔해 `photos/`로 복사
- **10MB 초과** 파일 자동 제외
- **`-2` 쌍 처리**: 같은 이름의 원본·웹 익스포트 쌍이 있을 때 작은 파일 선택
- 파일명 공백 → 언더스코어 (`내 사진.jpg` → `내_사진.jpg`)
- 이미 존재하는 파일은 건너뜀 (`--force`로 덮어쓰기 가능)

### 2단계 — WebP 변환

```bash
python3 scripts/optimize-images.py
python3 scripts/optimize-images.py --quality 85   # 품질 조정
python3 scripts/optimize-images.py --dry-run      # 미리보기 (실제 변환 없음)
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--quality` | 82 | WebP 품질 (0–100) |
| `--max-dim` | 2400 | 긴 쪽 최대 픽셀 |
| `--dry-run` | — | 변환하지 않고 예상 결과만 출력 |

- `cwebp`로 변환, 없으면 Pillow로 자동 fallback
- 원본은 `photos/originals/`에 보존 (`.gitignore` 처리됨)

### 3단계 — photos.js 재생성

```bash
python3 scripts/generate-photos.py
python3 scripts/generate-photos.py --keep         # 기존 title/category 유지
python3 scripts/generate-photos.py --sort mtime   # 파일 수정 시간 정렬
```

- `photos/`를 스캔해 EXIF를 읽고 `js/photos.js` 재생성
- 기본 정렬: **색상 흐름(color flow)** — 각 이미지의 대표 색상을 CIE Lab으로 변환 후 nearest-neighbor TSP로 색이 자연스럽게 이어지는 순서로 배열
- `--keep`: `title`·`category`를 수동 편집한 경우 반드시 사용

### 4단계 — 배포

```bash
wrangler pages deploy . --project-name photography
```

---

## 페이지 구조

단일 페이지 애플리케이션(SPA)으로, 하나의 `index.html` 안에서 구성됩니다.

```
index.html
│
├── Hero Section
│   ├── 배경: landscape 사진 중 랜덤 선택 + Ken Burns 애니메이션
│   └── 스크롤 힌트 아이콘
│
├── Gallery Section
│   ├── 필터 바 (All / Landscape / Portrait / Street / Nature)
│   ├── 사진 카운터 (표시 수 / 전체)
│   └── Masonry 그리드
│       └── 사진 카드 → 클릭 시 Lightbox
│
├── Lightbox
│   ├── 이전 / 다음 (← →, 스와이프)
│   ├── EXIF 패널 (카메라·렌즈·조리개·셔터·ISO·날짜)
│   └── 색상 팔레트 패널 (k-means++ 5색, fly-in/fly-out)
│
└── Footer
```

---

## 기능

| 기능 | 설명 |
|------|------|
| **Masonry 갤러리** | CSS `columns` 기반, landscape·portrait·square 비율 자동 처리 |
| **카테고리 필터** | All · Landscape · Portrait · Street · Nature, 실시간 카운터 |
| **Lazy load** | IntersectionObserver (200px margin) + 스켈레톤 shimmer |
| **Hero 배경** | landscape 사진 중 랜덤 선택, Ken Burns + 페이드인 |
| **라이트박스** | 전체화면, 키보드(← → Esc) · 터치 스와이프 지원 |
| **EXIF 표시** | 카메라·렌즈·조리개·셔터·ISO·날짜 자동 파싱 |
| **색상 팔레트** | k-means++ 5색 추출, 이미지 내 원본 좌표 기반 fly-in/fly-out |
| **색상 흐름 정렬** | Lab nearest-neighbor TSP — 갤러리 전체가 색 그라데이션처럼 흘러감 |
| **반응형** | `clamp()` 유동 타이포그래피, 모바일·태블릿·데스크탑 대응 |

---

## 의존 도구 설치

```bash
brew install exiftool          # EXIF 메타데이터 읽기
brew install webp              # cwebp (WebP 변환, 없으면 Pillow fallback)
pip install Pillow             # 색상 흐름 정렬용 이미지 분석
npm install -g wrangler        # Cloudflare Pages 배포
```

| 도구 | 필수 여부 | 용도 |
|------|-----------|------|
| `exiftool` | 필수 | EXIF 읽기 |
| `cwebp` | 선택 | WebP 변환 (없으면 Pillow 사용) |
| `Pillow` | 필수 | WebP 변환 fallback + 색상 분석 |
| `wrangler` | 배포 시 필수 | Cloudflare Pages 배포 |

# Photography

Daeseong Kim의 개인 사진 갤러리. 바닐라 HTML/CSS/JS로 구현되어 Cloudflare Pages에 배포됩니다.

**배포 URL**: https://photography-9zb.pages.dev  
**GitHub**: https://github.com/lemonardo1/photography

---

## 목차

- [디렉토리 구조](#디렉토리-구조)
- [페이지 위계](#페이지-위계)
- [기능](#기능)
- [사진 추가 워크플로](#사진-추가-워크플로)
- [의존 도구](#의존-도구)

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
└── scripts/
    ├── import-photos.py         # temp/ → photos/ 복사 및 정리
    ├── optimize-images.py       # JPG/PNG/HEIC → WebP 변환 + 리사이즈
    └── generate-photos.py       # EXIF 읽기 → js/photos.js 생성
```

---

## 페이지 위계

단일 페이지 애플리케이션(SPA)으로, 하나의 `index.html` 내에서 세 개의 레이어로 구성됩니다.

```
index.html
│
├── 1. Hero Section  ──────────────────────────────────────────
│   ├── 배경: landscape 사진 중 랜덤 선택 + Ken Burns 애니메이션
│   ├── 타이틀: "Photography by Daeseong Kim"
│   └── 스크롤 힌트 아이콘
│
├── 2. Gallery Section  ────────────────────────────────────────
│   ├── 필터 바
│   │   ├── All
│   │   ├── Landscape
│   │   ├── Portrait
│   │   ├── Street
│   │   └── Nature
│   ├── 사진 카운터 (현재 표시 수 / 전체)
│   └── Masonry 그리드
│       ├── 사진 카드 (WebP, lazy load + 스켈레톤)
│       │   ├── hover: 제목 · 카테고리 오버레이
│       │   └── click → Lightbox 열림
│       └── … (현재 41장)
│
├── 3. Lightbox (모달 오버레이)  ────────────────────────────────
│   ├── 이미지 뷰어 (전체화면)
│   ├── 이전 / 다음 화살표 (필터 내 순서 유지)
│   ├── 닫기 버튼 / ESC / 배경 클릭
│   ├── EXIF 정보 패널
│   │   ├── 카메라 기종
│   │   ├── 렌즈
│   │   ├── 초점 거리
│   │   ├── 조리개
│   │   ├── 셔터 스피드
│   │   ├── ISO
│   │   └── 촬영 날짜
│   └── 색상 팔레트 패널
│       ├── 이미지에서 5색 추출 (Canvas + k-means++)
│       ├── 각 색상 점이 원본 좌표에서 fly-in
│       └── 스와치 클릭 → 원본 위치로 fly-out 후 복귀
│
└── 4. Footer  ──────────────────────────────────────────────────
    └── 저작권 · 포트폴리오 링크
```

### 사용자 탐색 흐름

```
페이지 진입
    ↓
Hero 배경 페이드인 + 갤러리 로드
    ↓
스크롤 → Gallery Section
    ↓
[선택] 필터 클릭 → 카테고리별 사진만 표시
    ↓
사진 클릭 → Lightbox 오픈
    ↓
EXIF 확인 · 색상 팔레트 탐색
    ↓
← → 키 / 스와이프 → 이전·다음 사진
    ↓
ESC / 닫기 → Gallery 복귀 (필터 상태 유지)
```

---

## 기능

| 기능 | 설명 |
|------|------|
| **Masonry 갤러리** | CSS `columns` 기반, landscape·portrait·square 비율 자동 처리 |
| **카테고리 필터** | landscape · portrait · street · nature, 사진 카운터 실시간 업데이트 |
| **Lazy load** | IntersectionObserver (200px margin) + 스켈레톤 shimmer 애니메이션 |
| **Hero 배경** | landscape 사진 중 랜덤 선택, Ken Burns + 페이드인 |
| **라이트박스** | 전체화면 이미지, 키보드(← → Esc) · 터치 스와이프 지원 |
| **EXIF 표시** | 카메라·렌즈·조리개·셔터·ISO·날짜 자동 파싱 |
| **색상 팔레트** | k-means++ 5색 추출, 이미지 내 원본 좌표 기반 fly-in/fly-out 애니메이션 |
| **색상 흐름 정렬** | 빌드 타임에 Lab nearest-neighbor TSP로 색이 자연스럽게 이어지는 순서로 배열 |
| **반응형** | `clamp()` 유동 타이포그래피, 모바일·태블릿·데스크탑 대응 |

---

## 사진 추가 워크플로

### 1. 가져오기

```bash
# 원본 파일을 temp/ 에 복사 후 실행
python3 scripts/import-photos.py
```

`temp/` → `photos/` 복사. 10MB 초과 파일 제외, `-2` 쌍(web export 중복) 자동 처리, 파일명 공백 → 언더스코어.

### 2. WebP 최적화

```bash
python3 scripts/optimize-images.py
# 옵션: --quality 82 (기본)  --max-dim 2400 (기본)  --dry-run (미리보기)
```

JPG/PNG/HEIC → WebP 변환 + 최대 2400px 리사이즈. 원본은 `photos/originals/`에 보존. `cwebp` 없으면 Pillow 자동 fallback.

### 3. photos.js 생성

```bash
python3 scripts/generate-photos.py
# --keep         기존 title/category 수동 설정 유지
# --sort color   색상 흐름 정렬 (기본값)
# --sort mtime   파일 수정 시간 정렬
```

`photos/`를 스캔해 EXIF를 읽고 `js/photos.js`를 재생성. 기본적으로 **색상 흐름(color flow)** 순서로 정렬됨 — Pillow로 각 이미지의 대표 색상을 추출하고 CIE Lab 공간에서 nearest-neighbor TSP로 색이 자연스럽게 이어지도록 배열. 실행 후 `title`과 `category`를 필요에 따라 수동 편집.

### 4. 배포

```bash
wrangler pages deploy . --project-name photography
```

---

## 의존 도구

| 도구 | 용도 | 설치 |
|------|------|------|
| `exiftool` | EXIF 메타데이터 읽기 | `brew install exiftool` |
| `cwebp` | WebP 변환 (fallback: Pillow) | `brew install webp` |
| `Pillow` | 색상 흐름 정렬용 이미지 분석 | `pip install Pillow` |
| `wrangler` | Cloudflare Pages 배포 | `npm install -g wrangler` |

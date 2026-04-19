(() => {
  'use strict';

  /* ── State ──────────────────────────────────────────────── */
  let currentFilter = 'all';
  let lightboxIndex = -1;
  let filteredPhotos = [];
  let activeDots     = [];
  let currentColors  = [];
  let currentSwatches = [];

  /* ── DOM refs ───────────────────────────────────────────── */
  const gallery     = document.getElementById('gallery');
  const filterBtns  = document.querySelectorAll('.filter-btn');
  const photoCount  = document.getElementById('photoCount');

  const lightbox    = document.getElementById('lightbox');
  const lbBackdrop  = document.getElementById('lbBackdrop');
  const lbImg       = document.getElementById('lbImg');
  const lbSpinner   = document.getElementById('lbSpinner');
  const lbTitle     = document.getElementById('lbTitle');
  const lbInfo      = document.getElementById('lbInfo');
  const lbCounter   = document.getElementById('lbCounter');
  const lbClose     = document.getElementById('lbClose');
  const lbPalette   = document.getElementById('lbPalette');


  /* ── Intersection Observer (lazy load + fade in) ────────── */
  const imgObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const item = entry.target;
      const img  = item.querySelector('img[data-src]');
      if (img) {
        img.src = img.dataset.src;
        img.onload = () => {
          item.classList.remove('skeleton');
          item.classList.add('visible');
        };
        img.onerror = () => item.classList.add('visible');
        imgObserver.unobserve(item);
      } else {
        item.classList.add('visible');
        imgObserver.unobserve(item);
      }
    });
  }, { rootMargin: '200px 0px', threshold: 0.01 });

  /* ── Build gallery ──────────────────────────────────────── */
  function buildGallery() {
    gallery.innerHTML = '';

    window.PHOTOS.forEach((photo, index) => {
      const item = document.createElement('div');
      item.className = 'gallery-item skeleton';
      item.dataset.index    = index;
      item.dataset.category = photo.category;

      const img = document.createElement('img');
      img.dataset.src = photo.src;
      img.alt = photo.title;
      img.width  = photo.aspect === 'portrait' ? 800 : 1200;
      img.height = photo.aspect === 'portrait' ? 1000 : 800;

      const overlay = document.createElement('div');
      overlay.className = 'gallery-item-overlay';
      overlay.innerHTML = `
        <div class="item-title">${escHtml(photo.title)}</div>
        <div class="item-meta">${escHtml(photo.category.toUpperCase())}</div>
      `;

      item.appendChild(img);
      item.appendChild(overlay);

      item.addEventListener('click', () => openLightbox(index));
      item.addEventListener('keydown', e => { if (e.key === 'Enter') openLightbox(index); });
      item.setAttribute('tabindex', '0');
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', `${photo.title} 보기`);

      gallery.appendChild(item);
      imgObserver.observe(item);
    });

    applyFilter(currentFilter, false);
  }

  /* ── Filter ──────────────────────────────────────────────── */
  function applyFilter(filter, animate = true) {
    currentFilter = filter;
    const items = gallery.querySelectorAll('.gallery-item');

    filteredPhotos = window.PHOTOS.filter(p => filter === 'all' || p.category === filter);
    photoCount.textContent = `${filteredPhotos.length} photo${filteredPhotos.length !== 1 ? 's' : ''}`;

    items.forEach((item, i) => {
      const cat = item.dataset.category;
      const show = filter === 'all' || cat === filter;

      if (animate) {
        if (show) {
          item.classList.remove('hidden');
          requestAnimationFrame(() => item.classList.add('visible'));
        } else {
          item.classList.remove('visible');
          item.addEventListener('transitionend', () => {
            if (currentFilter !== 'all' && item.dataset.category !== currentFilter) {
              item.classList.add('hidden');
            }
          }, { once: true });
        }
      } else {
        item.classList.toggle('hidden', !show);
      }
    });

    filterBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.filter === filter));
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => applyFilter(btn.dataset.filter));
  });

  /* ── Lightbox ────────────────────────────────────────────── */
  function getFilteredIndex(globalIndex) {
    return filteredPhotos.findIndex((_, i) => {
      // map filteredPhotos back to their global index
      const fp = filteredPhotos[i];
      return window.PHOTOS.indexOf(fp) === globalIndex;
    });
  }

  function openLightbox(globalIndex) {
    lightboxIndex = globalIndex;
    filteredPhotos = window.PHOTOS.filter(p => currentFilter === 'all' || p.category === currentFilter);

    lightbox.classList.add('open');
    lbBackdrop.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    history.replaceState(null, '', '?photo=' + (globalIndex + 1));
    loadLightboxImage(globalIndex);
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    lbBackdrop.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    lbImg.classList.remove('loaded');
    lbPalette.classList.remove('ready');
    lbPalette.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('active'));
    clearActiveDots();
    lightboxIndex = -1;
    history.replaceState(null, '', location.pathname);
  }

  /* ── Color Palette ───────────────────────────────────────── */
  function showPaletteSkeleton() {
    lbPalette.classList.remove('ready');
    lbPalette.innerHTML = Array.from({ length: 5 }, () =>
      `<div class="palette-swatch">
        <div class="palette-swatch-color loading"></div>
        <span class="palette-swatch-hex">——</span>
      </div>`
    ).join('');
  }

  function clearActiveDots() {
    activeDots.forEach(dot => dot.remove());
    activeDots = [];
  }

  // 팔레트 위치 → 이미지 원래 위치 → 팔레트 위치 왕복 애니메이션
  function animatePaletteRoundTrip() {
    clearActiveDots();

    const imgRect       = lbImg.getBoundingClientRect();
    const INITIAL_DELAY = 260;   // 클릭 후 첫 dot 등장까지 여유
    const STAGGER       = 140;   // dot 간 출발 편차
    const PAUSE_AT_IMG  = 720;   // 이미지 도착 후 대기 시간
    const FLY_DUR       = 580;   // 비행 시간 (ms)

    currentSwatches.forEach((sw, i) => {
      const colorEl = sw.querySelector('.palette-swatch-color');
      const srcRect = colorEl.getBoundingClientRect();

      // dot을 팔레트 스워치 위치에서 1px 점으로 생성
      const dot = document.createElement('div');
      dot.className        = 'color-origin-dot';
      dot.style.background = currentColors[i].hex;
      dot.style.left       = (srcRect.left + srcRect.width  / 2) + 'px';
      dot.style.top        = (srcRect.top  + srcRect.height / 2) + 'px';
      dot.style.transform  = 'translate(-50%, -50%) scale(0.04)';
      document.body.appendChild(dot);
      activeDots.push(dot);

      const [nx, ny] = currentColors[i].pos;
      const imageX   = imgRect.left + nx * imgRect.width;
      const imageY   = imgRect.top  + ny * imgRect.height;

      const GROW_DUR_RT = 400;  // 1px → 원형 성장 시간
      const flyS        = (FLY_DUR / 1000).toFixed(2) + 's';
      const T_APPEAR    = INITIAL_DELAY + i * STAGGER;
      const T_FLY_OUT   = T_APPEAR + GROW_DUR_RT + 80;         // 성장 완료 후 80ms 여유
      const T_FLY_BACK  = T_FLY_OUT + FLY_DUR + PAUSE_AT_IMG;  // 이미지 → 팔레트
      const T_ARRIVE    = T_FLY_BACK + FLY_DUR + 20;

      // 1) 팔레트 위치에서 1px → 원형으로 성장
      setTimeout(() => {
        dot.style.transition = `transform ${(GROW_DUR_RT / 1000).toFixed(2)}s cubic-bezier(0.34, 1.56, 0.64, 1)`;
        dot.style.transform  = 'translate(-50%, -50%) scale(1)';
      }, T_APPEAR);

      // 2) 이미지 내 원래 위치로 날아가기
      setTimeout(() => {
        dot.style.transition = [
          `left ${flyS} cubic-bezier(0.4, 0, 0.2, 1)`,
          `top  ${flyS} cubic-bezier(0.4, 0, 0.2, 1)`,
        ].join(', ');
        dot.style.left = imageX + 'px';
        dot.style.top  = imageY + 'px';
      }, T_FLY_OUT);

      // 3) 다시 팔레트 위치로 돌아오기
      setTimeout(() => {
        const destRect = colorEl.getBoundingClientRect();
        dot.style.transition = [
          `left      ${flyS} cubic-bezier(0.4, 0, 0.2, 1)`,
          `top       ${flyS} cubic-bezier(0.4, 0, 0.2, 1)`,
          `transform ${flyS} ease`,
          'opacity   0.28s ease 0.32s',
        ].join(', ');
        dot.style.left      = (destRect.left + destRect.width  / 2) + 'px';
        dot.style.top       = (destRect.top  + destRect.height / 2) + 'px';
        dot.style.transform = 'translate(-50%, -50%) scale(0.5)';
        dot.style.opacity   = '0';
      }, T_FLY_BACK);

      // 4) 도착 — dot 제거 + 스워치 bounce
      setTimeout(() => {
        dot.remove();
        activeDots = activeDots.filter(d => d !== dot);

        colorEl.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
        colorEl.style.transform  = 'scale(1.35)';
        setTimeout(() => {
          colorEl.style.transform = '';
          setTimeout(() => { colorEl.style.transition = ''; }, 300);
        }, 40);
      }, T_ARRIVE);
    });
  }


  function renderPalette(img) {
    const colors = ColorPicker.extract(img, 5);
    if (!colors.length) { lbPalette.innerHTML = ''; return; }

    // 모듈 스코프에 저장 (왕복 애니메이션에서 참조)
    currentColors  = colors;

    // 스워치 빌드 — 개별적으로 숨긴 상태로 시작 (도트가 날아와 하나씩 드러냄)
    lbPalette.innerHTML = colors.map(({ hex }) =>
      `<div class="palette-swatch" data-hex="${hex}" title="색상 정보" style="opacity:0;pointer-events:none">
        <div class="palette-swatch-color" style="background:${hex};"></div>
        <span class="palette-swatch-hex">${hex}</span>
      </div>`
    ).join('');

    const swatches = [...lbPalette.querySelectorAll('.palette-swatch')];
    currentSwatches = swatches;

    // 클릭 핸들러 미리 등록
    swatches.forEach((sw, i) => {
      sw.addEventListener('click', () => {
        const isActive = sw.classList.contains('active');
        swatches.forEach(s => s.classList.remove('active'));
        if (!isActive) sw.classList.add('active');

        // 클릭마다 5개 전체 왕복 애니메이션
        animatePaletteRoundTrip();
      });
    });

    // 팔레트 컨테이너 즉시 표시 (개별 스워치는 여전히 opacity:0)
    lbPalette.classList.add('ready');

    // ── 이미지 → 팔레트 fly-in 애니메이션 ──────────────────
    const imgRect        = lbImg.getBoundingClientRect();
    const STAGGER_IN     = 110;  // dot 간 등장 간격
    const GROW_DUR       = 420;  // 1px → 원형 성장 시간
    const PAUSE_GROWN    = 180;  // 완전히 커진 뒤 출발 전 여유
    const FLY_DUR_IN     = 540;  // 팔레트까지 비행 시간
    const flyInS         = (FLY_DUR_IN / 1000).toFixed(2) + 's';

    colors.forEach((colorObj, i) => {
      const { hex, pos: [nx, ny] } = colorObj;

      const originX = imgRect.left + nx * imgRect.width;
      const originY = imgRect.top  + ny * imgRect.height;

      // dot을 1px 점으로 생성 (아직 비가시 크기)
      const dot = document.createElement('div');
      dot.className        = 'color-origin-dot';
      dot.style.background = hex;
      dot.style.left       = originX + 'px';
      dot.style.top        = originY + 'px';
      dot.style.transform  = 'translate(-50%, -50%) scale(0.04)';
      document.body.appendChild(dot);
      activeDots.push(dot);

      const T_GROW   = i * STAGGER_IN;
      const T_FLY    = T_GROW + GROW_DUR + PAUSE_GROWN;
      const T_ARRIVE = T_FLY  + FLY_DUR_IN + 20;

      // 1단계: 1px → 원형으로 성장
      setTimeout(() => {
        dot.style.transition = `transform ${(GROW_DUR / 1000).toFixed(2)}s cubic-bezier(0.34, 1.56, 0.64, 1)`;
        dot.style.transform  = 'translate(-50%, -50%) scale(1)';
      }, T_GROW);

      // 2단계: 팔레트 스워치 위치로 날아가기
      setTimeout(() => {
        const destRect = swatches[i].querySelector('.palette-swatch-color').getBoundingClientRect();
        const destX = destRect.left + destRect.width  / 2;
        const destY = destRect.top  + destRect.height / 2;

        dot.style.transition = [
          `left      ${flyInS} cubic-bezier(0.4, 0, 0.2, 1)`,
          `top       ${flyInS} cubic-bezier(0.4, 0, 0.2, 1)`,
          `transform ${flyInS} ease`,
          'opacity   0.26s ease 0.3s',
        ].join(', ');
        dot.style.left      = destX + 'px';
        dot.style.top       = destY + 'px';
        dot.style.transform = 'translate(-50%, -50%) scale(0.55)';
        dot.style.opacity   = '0';
      }, T_FLY);

      // 3단계: 도착 — 도트 제거 + 스워치 팝 등장
      setTimeout(() => {
        dot.remove();
        activeDots = activeDots.filter(d => d !== dot);

        const sw = swatches[i];
        sw.style.transition    = 'opacity 0.15s ease';
        sw.style.opacity       = '1';
        sw.style.pointerEvents = '';

        const colorEl = sw.querySelector('.palette-swatch-color');
        colorEl.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
        colorEl.style.transform  = 'scale(1.35)';
        setTimeout(() => {
          colorEl.style.transform = '';
          setTimeout(() => { colorEl.style.transition = ''; }, 300);
        }, 40);
      }, T_ARRIVE);
    });
  }

  function loadLightboxImage(globalIndex) {
    const photo = window.PHOTOS[globalIndex];
    if (!photo) return;

    clearActiveDots();
    lbPalette.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('active'));

    lbImg.classList.remove('loaded');
    lbSpinner.classList.remove('hidden');

    lbImg.onload = () => {
      lbSpinner.classList.add('hidden');
      lbImg.classList.add('loaded');
      renderPalette(lbImg);
    };
    lbImg.onerror = () => lbSpinner.classList.add('hidden');

    // 팔레트 초기화 (로딩 스켈레톤)
    showPaletteSkeleton();
    lbImg.src = photo.src;
    lbImg.alt = photo.title;

    lbTitle.textContent = photo.title;
    lbInfo.textContent = photo.info || '';

    // Counter: position within filtered set
    const pos = getFilteredPhotoPosition(globalIndex);
    lbCounter.textContent = `${pos}`;

  }

  function getFilteredPhotoPosition(globalIndex) {
    const idx = filteredPhotos.findIndex(p => window.PHOTOS.indexOf(p) === globalIndex);
    return idx + 1;
  }

  function navigateLightbox(direction) {
    const currentPos = getFilteredPhotoPosition(lightboxIndex);
    const nextPos    = currentPos + direction;
    if (nextPos < 1 || nextPos > filteredPhotos.length) return;

    const nextPhoto  = filteredPhotos[nextPos - 1];
    const nextGlobal = window.PHOTOS.indexOf(nextPhoto);
    lightboxIndex = nextGlobal;
    history.replaceState(null, '', '?photo=' + (nextGlobal + 1));
    loadLightboxImage(nextGlobal);
  }

  lbClose.addEventListener('click', closeLightbox);
  lbBackdrop.addEventListener('click', closeLightbox);

  /* ── Keyboard nav ────────────────────────────────────────── */
  document.addEventListener('keydown', e => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape')      closeLightbox();
    if (e.key === 'ArrowLeft')   navigateLightbox(-1);
    if (e.key === 'ArrowRight')  navigateLightbox(1);
  });

  /* ── Touch/swipe for lightbox ────────────────────────────── */
  let touchStartX = 0;
  lightbox.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, { passive: true });
  lightbox.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 50) navigateLightbox(dx < 0 ? 1 : -1);
  }, { passive: true });


  /* ── Utility ─────────────────────────────────────────────── */
  function escHtml(str) {
    return str.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ── Hero background ────────────────────────────────────── */
  function initHero() {
    const heroBg = document.getElementById('heroBg');
    if (!heroBg || !window.PHOTOS.length) return;

    const pool = window.PHOTOS.filter(p => p.aspect === 'landscape');
    const pick = pool.length
      ? pool[Math.floor(Math.random() * pool.length)]
      : window.PHOTOS[Math.floor(Math.random() * window.PHOTOS.length)];

    // 이미지 프리로드 후 배경 적용
    const img = new Image();
    img.onload = () => {
      heroBg.style.backgroundImage = `url('${pick.src}')`;
      heroBg.style.opacity = '0';
      heroBg.style.transition = 'opacity 1.2s ease';
      requestAnimationFrame(() => { heroBg.style.opacity = '1'; });
    };
    img.src = pick.src;
  }

  /* ── Init ────────────────────────────────────────────────── */
  initHero();
  buildGallery();

  const photoParam = new URLSearchParams(location.search).get('photo');
  if (photoParam) {
    const idx = parseInt(photoParam, 10) - 1;
    if (idx >= 0 && idx < window.PHOTOS.length) openLightbox(idx);
  }

})();

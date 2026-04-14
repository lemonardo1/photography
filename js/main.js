(() => {
  'use strict';

  /* ── State ──────────────────────────────────────────────── */
  let currentFilter = 'all';
  let lightboxIndex = -1;
  let filteredPhotos = [];

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
    filteredPhotos = window.PHOTOS.filter(p => currentFilter === 'all' || p.category === p.category);
    // recalc with correct filter
    filteredPhotos = window.PHOTOS.filter(p => currentFilter === 'all' || p.category === currentFilter);

    lightbox.classList.add('open');
    lbBackdrop.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    loadLightboxImage(globalIndex);
  }

  function closeLightbox() {
    lightbox.classList.remove('open');
    lbBackdrop.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    lbImg.classList.remove('loaded');
    lbPalette.classList.remove('ready');
    lightboxIndex = -1;
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

  function renderPalette(img) {
    const colors = ColorPicker.extract(img, 5);
    if (!colors.length) { lbPalette.innerHTML = ''; return; }

    lbPalette.innerHTML = colors.map(({ hex, lum }) => {
      const textColor = lum > 0.55 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)';
      return `<div class="palette-swatch" data-hex="${hex}" title="클릭해서 복사">
        <div class="palette-swatch-color" style="background:${hex};"></div>
        <span class="palette-swatch-hex">${hex}</span>
      </div>`;
    }).join('');

    // 클릭 → hex 복사
    lbPalette.querySelectorAll('.palette-swatch').forEach(sw => {
      sw.addEventListener('click', () => copyHex(sw.dataset.hex, sw.querySelector('.palette-swatch-color')));
    });

    requestAnimationFrame(() => lbPalette.classList.add('ready'));
  }

  function copyHex(hex, colorEl) {
    navigator.clipboard.writeText(hex).catch(() => {});
    colorEl.classList.remove('copied');
    void colorEl.offsetWidth;
    colorEl.classList.add('copied');
  }

  function loadLightboxImage(globalIndex) {
    const photo = window.PHOTOS[globalIndex];
    if (!photo) return;

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
    // info + date 조합
    const infoParts = [photo.info, photo.date].filter(Boolean);
    lbInfo.textContent = infoParts.join('  ·  ');

    // Counter: position within filtered set
    const pos = getFilteredPhotoPosition(globalIndex);
    lbCounter.textContent = `${pos} / ${filteredPhotos.length}`;

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

})();

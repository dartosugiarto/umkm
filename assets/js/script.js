(function () {
  'use strict';
  
  // KONFIGURASI BARU UNTUK UMKM
  const config = {
    sheetId: '10bjcfNHBP6jCnLE87pgk5rXgVS8Qwyu8hc-LXCkdqEE', // <-- ID Google Sheet BARU
    sheets: {
      // Hapus sheet yang tidak perlu
      accounts: { name: 'Produk' }, // <-- Nama Sheet BARU
    },
    waNumber: '628XXXXXXXXX', // <-- GANTI NOMOR WA UMKM
    waGreeting: '*Halo, saya mau pesan produk ini:*', // <-- Sapaan WA BARU
    paymentOptions: [
      { id: 'seabank', name: 'Seabank', feeType: 'fixed', value: 0 },
      { id: 'gopay', name: 'Gopay', feeType: 'fixed', value: 0 },
      { id: 'dana', name: 'Dana', feeType: 'fixed', value: 125 },
      { id: 'bank_to_dana', name: 'Bank ke Dana', feeType: 'fixed', value: 500 },
      { id: 'qris', name: 'Qris', feeType: 'percentage', value: 0.01 },
    ],
  };

  // STATE YANG DIPERLUKAN SAJA
  const state = {
    accounts: {
      initialized: false,
      allData: [],
      activeCategory: 'Semua Kategori',
    },
  };
  
  let currentSelectedItem = null;
  let accountsFetchController;
  let modalFocusTrap = { listener: null, focusableEls: [], firstEl: null, lastEl: null };
  let elementToFocusOnModalClose = null;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function getElement(id) {
    return document.getElementById(id);
  }

  // ELEMEN YANG DIPERLUKAN SAJA
  const elements = {
    sidebar: {
      nav: getElement('sidebarNav'),
      overlay: getElement('sidebarOverlay'),
      burger: getElement('burgerBtn'),
    },
    navLinks: document.querySelectorAll('[data-mode]'),
    viewAccounts: getElement('viewAccounts'),
    headerStatusIndicator: getElement('headerStatusIndicator'),
    paymentModal: {
      modal: getElement('paymentModal'),
      closeBtn: getElement('closeModalBtn'),
      itemName: getElement('modalItemName'),
      itemPrice: getElement('modalItemPrice'),
      optionsContainer: getElement('paymentOptionsContainer'),
      fee: getElement('modalFee'),
      total: getElement('modalTotal'),
      waBtn: getElement('continueToWaBtn'),
    },
    accounts: {
      cardGrid: getElement('accountCardGrid'),
      cardTemplate: getElement('accountCardTemplate'),
      empty: getElement('accountEmpty'),
      error: getElement('accountError'),
      customSelect: {
        wrapper: getElement('accountCustomSelectWrapper'),
        btn: getElement('accountCustomSelectBtn'),
        value: getElement('accountCustomSelectValue'),
        options: getElement('accountCustomSelectOptions'),
      },
    },
  };

  function formatToIdr(value) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value); }
  function getSheetUrl(sheetName, format = 'json') { const baseUrl = `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq`; const encodedSheetName = encodeURIComponent(sheetName); return format === 'csv' ? `${baseUrl}?tqx=out:csv&sheet=${encodedSheetName}` : `${baseUrl}?sheet=${encodedSheetName}&tqx=out:json`; }

async function fetchSheetCached(sheetName, format = 'json'){
  const url = getSheetUrl(sheetName, format === 'csv' ? 'csv' : 'json');
  const key = `pp_cache_${sheetName}_${format}`;
  const cached = sessionStorage.getItem(key);
  if (cached) {
    // kick off background revalidate
    try { fetch(url).then(r => r.text()).then(t => sessionStorage.setItem(key, t)); } catch(e) {}
    return cached;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Network error: ${res.statusText}`);
  const text = await res.text();
  sessionStorage.setItem(key, text);
  return text;
}

  function toggleCustomSelect(wrapper, forceOpen) { const btn = wrapper.querySelector('.custom-select-btn'); const isOpen = typeof forceOpen === 'boolean' ? forceOpen : !wrapper.classList.contains('open'); wrapper.classList.toggle('open', isOpen); btn.setAttribute('aria-expanded', isOpen); }

function enhanceCustomSelectKeyboard(wrapper){
  if (!wrapper) return;
  const options = wrapper.querySelector('.custom-select-options');
  const btn = wrapper.querySelector('.custom-select-btn');
  if (!options || !btn) return;
  options.setAttribute('role','listbox');
  options.addEventListener('keydown', (e)=>{
    const items = Array.from(options.querySelectorAll('.custom-select-option'));
    if (!items.length) return;
    let i = items.findIndex(o => o.classList.contains('highlight'));

    const move = (delta)=>{
      i = (i === -1 ? items.findIndex(o=>o.classList.contains('selected')) : i);
      if (i === -1) i = 0;
      i = (i + delta + items.length) % items.length;
      items.forEach(o=>o.classList.remove('highlight'));
      items[i].classList.add('highlight');
      items[i].scrollIntoView({ block: 'nearest' });
    };

    if (e.key === 'ArrowDown'){ e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp'){ e.preventDefault(); move(-1); }
    if (e.key === 'Home'){ e.preventDefault(); move(-9999); }
    if (e.key === 'End'){ e.preventDefault(); move(9999); }
    if (e.key === 'Enter'){ e.preventDefault(); if (i>-1) items[i].click(); }
    if (e.key === 'Escape'){ e.preventDefault(); toggleCustomSelect(wrapper, false); btn.focus(); }
  });
}

  function robustCsvParser(text) { const normalizedText = text.trim().replace(/\r\n/g, '\n'); const rows = []; let currentRow = []; let currentField = ''; let inQuotedField = false; for (let i = 0; i < normalizedText.length; i++) { const char = normalizedText[i]; if (inQuotedField) { if (char === '"') { if (i + 1 < normalizedText.length && normalizedText[i + 1] === '"') { currentField += '"'; i++; } else { inQuotedField = false; } } else { currentField += char; } } else { if (char === '"') { inQuotedField = true; } else if (char === ',') { currentRow.push(currentField); currentField = ''; } else if (char === '\n') { currentRow.push(currentField); rows.push(currentRow); currentRow = []; currentField = ''; } else { currentField += char; } } } currentRow.push(currentField); rows.push(currentRow); return rows; }
  
  function initializeCarousels(container) {
    container.querySelectorAll('.carousel-container').forEach(carouselContainer => {
      const track = carouselContainer.querySelector('.carousel-track');
      const slides = carouselContainer.querySelectorAll('.carousel-slide');
      const imageCount = slides.length;
      if (imageCount > 1) {
        const prevBtn = carouselContainer.querySelector('.prev');
        const nextBtn = carouselContainer.querySelector('.next');
        const indicators = carouselContainer.querySelectorAll('.indicator-dot');
        let currentIndex = 0;
        const update = () => {
          if (!track || !prevBtn || !nextBtn || !indicators) return;
          track.style.transform = `translateX(-${currentIndex * 100}%)`;
          prevBtn.disabled = currentIndex === 0;
          nextBtn.disabled = currentIndex >= imageCount - 1;
          indicators.forEach((dot, i) => dot.classList.toggle('active', i === currentIndex));
        };
        nextBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentIndex < imageCount - 1) {
            currentIndex++;
            update();
          }
        });
        prevBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (currentIndex > 0) {
            currentIndex--;
            update();
          }
        });
        indicators.forEach(dot => dot.addEventListener('click', (e) => {
          e.stopPropagation();
          currentIndex = parseInt(e.target.dataset.index, 10);
          update();
        }));
        update();
      }
    });
  }
  
  function setupExpandableCard(card, triggerSelector) {
    const trigger = card.querySelector(triggerSelector);
    if (trigger) {
      const action = (e) => {
        if (e.target.closest('a')) return;
        card.classList.toggle('expanded');
      };
      trigger.addEventListener('click', action);
      trigger.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) {
          e.preventDefault();
          action(e);
        }
      });
    }
  }

  // FUNGSI INI DARI VERSI LAMA ANDA, UNTUK MEMFORMAT DESKRIPSI
  function formatDescriptionToHTML(text) {
    if (!text) return '';
    return text.split('||').map(line => {
        const trimmedLine = line.trim();
        if (trimmedLine === '') {
            return '<br>';
        } else if (trimmedLine.endsWith(':')) {
            return `<p class="spec-title">${trimmedLine.slice(0, -1)}</p>`;
        } else if (trimmedLine.startsWith('\u203A')) { // Menggunakan Unicode Escape
            return `<p class="spec-item spec-item-arrow">${trimmedLine.substring(1).trim()}</p>`;
        } else if (trimmedLine.startsWith('-')) {
            return `<p class="spec-item spec-item-dash">${trimmedLine.substring(1).trim()}</p>`;
        } else if (trimmedLine.startsWith('#')) {
            return `<p class="spec-hashtag">${trimmedLine}</p>`;
        } else {
            return `<p class="spec-paragraph">${trimmedLine}</p>`;
        }
    }).join('');
  }
  
  function updateHeaderStatus() {
    const now = new Date();
    const options = { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false };
    const hour = parseInt(new Intl.DateTimeFormat('en-US', options).format(now), 10);
    const indicator = elements.headerStatusIndicator;
    // GANTI JAM BUKA/TUTUP DI SINI
    if (hour >= 8 && hour < 22) { // Contoh: Buka dari jam 8 pagi sampai 10 malam
      indicator.textContent = 'BUKA';
      indicator.className = 'status-badge success';
    } else {
      indicator.textContent = 'TUTUP';
      indicator.className = 'status-badge closed';
    }
  }
  
  function initializeApp() {
    elements.sidebar.burger?.addEventListener('click', () => toggleSidebar());
    elements.sidebar.overlay?.addEventListener('click', () => toggleSidebar(false));
    elements.navLinks.forEach(link => {
      link.addEventListener('click', e => {
        if (link.dataset.mode) {
          e.preventDefault();
          setMode(link.dataset.mode);
        }
      });
    });
    
    // Hanya inisialisasi custom select untuk 'accounts'
    if (elements.accounts.customSelect.btn) {
      elements.accounts.customSelect.btn.addEventListener('click', (e) => { e.stopPropagation(); toggleCustomSelect(elements.accounts.customSelect.wrapper); });
      enhanceCustomSelectKeyboard(elements.accounts.customSelect.wrapper);
    }

    elements.paymentModal.closeBtn.addEventListener('click', closePaymentModal);
    elements.paymentModal.modal.addEventListener('click', e => { if (e.target === elements.paymentModal.modal) closePaymentModal(); });
    
    document.addEventListener('keydown', (e)=>{ if (e.key==='Escape'){ if (elements.accounts.customSelect.wrapper) { toggleCustomSelect(elements.accounts.customSelect.wrapper,false); } } });
    document.addEventListener('click', (e) => {
      if (elements.accounts.customSelect.wrapper) {
        toggleCustomSelect(elements.accounts.customSelect.wrapper, false);
      }
    });

    // Cek mode dari URL, jika tidak valid, paksa ke 'accounts'
    const validModes = ['accounts']; // Hanya 'accounts' yang valid sekarang
    const initialMode = window.location.pathname.substring(1).toLowerCase() || 'accounts';
    setMode(validModes.includes(initialMode) ? initialMode : 'accounts', true);

    elements.headerStatusIndicator.style.display = 'inline-flex';
    updateHeaderStatus();
    setInterval(updateHeaderStatus, 60000);
  }
  
  function toggleSidebar(forceOpen) {
    const isOpen = typeof forceOpen === 'boolean' ? forceOpen : !document.body.classList.contains('sidebar-open');
    document.body.classList.toggle('sidebar-open', isOpen);
    elements.sidebar.burger.classList.toggle('active', isOpen);

    const body = document.body;
    if (isOpen) {
      const y = window.scrollY || window.pageYOffset || 0;
      body.dataset.ppLockY = String(y);
      body.style.position = 'fixed';
      body.style.top = `-${y}px`;
      body.style.width = '100%';
      body.style.overflow = 'hidden';
    } else {
      const y = parseInt(body.dataset.ppLockY || '0', 10);
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
      body.style.overflow = '';
      window.scrollTo(0, y);
    }
  }

  // FUNGSI SETMODE YANG DISIMPLIKASI
  let setMode = function(nextMode, fromPopState = false) {
    if (nextMode !== 'accounts') nextMode = 'accounts'; // Paksa ke 'accounts' jika mode tidak valid

    const viewMap = { accounts: elements.viewAccounts };
    const nextView = viewMap[nextMode];
    if (!nextView) return;

    const pageName = "Katalog Produk"; // Judul halaman statis
    
    if (!fromPopState) {
        const search = window.location.search;
        // Selalu set path ke root '/' atau '/index.html'
        const path = `/${search}`;
        history.pushState({ mode: nextMode }, `Nama UMKM - ${pageName}`, path);
    }
    document.title = `Nama UMKM - ${pageName}`;
    
    document.querySelector('.view-section.active')?.classList.remove('active');
    nextView.classList.add('active');
    
    elements.navLinks.forEach(link => {
        const isActive = link.dataset.mode === nextMode;
        link.classList.toggle('active', isActive);
        isActive ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current');
    });
    
    if (window.innerWidth < 769) toggleSidebar(false);
    
    if (nextMode === 'accounts' && !state.accounts.initialized) {
        initializeAccounts(); // Langsung panggil ini saat load
    }
  }

  function calculateFee(price, option) { if (option.feeType === 'fixed') return option.value; if (option.feeType === 'percentage') return Math.ceil(price * option.value); return 0; }
  
  function updatePriceDetails() { const selectedOptionId = document.querySelector('input[name="payment"]:checked')?.value; if (!selectedOptionId) return; const selectedOption = config.paymentOptions.find(opt => opt.id === selectedOptionId); if (!currentSelectedItem || !selectedOption) return; const price = currentSelectedItem.price; const fee = calculateFee(price, selectedOption); const total = price + fee; elements.paymentModal.fee.textContent = formatToIdr(fee); elements.paymentModal.total.textContent = formatToIdr(total); updateWaLink(selectedOption, fee, total); }

  function updateWaLink(option, fee, total) {
    const { catLabel = "Produk", title, price } = currentSelectedItem;
    const text = [
      config.waGreeting,
      `\u203A Tipe: ${catLabel}`,
      `\u203A Item: ${title}`,
      `\u203A Pembayaran: ${option.name}`,
      `\u203A Harga: ${formatToIdr(price)}`,
      `\u203A Fee: ${formatToIdr(fee)}`,
      `\u203A Total: ${formatToIdr(total)}`,
    ].join('\n');
    elements.paymentModal.waBtn.href = `https://wa.me/${config.waNumber}?text=${encodeURIComponent(text)}`;
  }

  function openPaymentModal(item) {
    const pageContainer = document.getElementById('pageContainer');
    const modalContentEl = document.querySelector('#paymentModal .modal-content');
    if (modalContentEl){ modalContentEl.setAttribute('role','dialog'); modalContentEl.setAttribute('aria-modal','true'); modalContentEl.setAttribute('aria-labelledby','paymentModalTitle'); }
    const modalTitle = document.querySelector('#paymentModal .modal-header h2');
    if (modalTitle){ modalTitle.id = 'paymentModalTitle'; }
    if (pageContainer){ pageContainer.setAttribute('inert',''); }
    document.documentElement.style.overflow = "hidden"; document.body.style.overflow = "hidden";
    elementToFocusOnModalClose = document.activeElement;
    currentSelectedItem = item;
    const { modal, itemName, itemPrice, optionsContainer } = elements.paymentModal;
    itemName.textContent = item.title;
    itemPrice.textContent = formatToIdr(item.price);
    optionsContainer.innerHTML = '';
    config.paymentOptions.forEach((option, index) => {
      const fee = calculateFee(item.price, option);
      optionsContainer.insertAdjacentHTML('beforeend', ` <div class="payment-option"> <input type="radio" id="${option.id}" name="payment" value="${option.id}" ${index === 0 ? 'checked' : ''}> <label for="${option.id}" tabindex="0"> ${option.name} <span style="float: right;">+ ${formatToIdr(fee)}</span> </label> </div>`);
    });
    optionsContainer.querySelectorAll('input[name="payment"]').forEach(input => input.addEventListener('change', updatePriceDetails));
    updatePriceDetails();
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('visible'), 10);
    const focusableEls = modal.querySelectorAll('a[href]:not([disabled]), button:not([disabled]), input[type="radio"]:not([disabled])');
    modalFocusTrap.focusableEls = Array.from(focusableEls);
    modalFocusTrap.firstEl = modalFocusTrap.focusableEls[0];
    modalFocusTrap.lastEl = modalFocusTrap.focusableEls[modalFocusTrap.focusableEls.length - 1];
    modalFocusTrap.listener = function(e) { if (e.key !== 'Tab') return; if (e.shiftKey) { if (document.activeElement === modalFocusTrap.firstEl) { modalFocusTrap.lastEl.focus(); e.preventDefault(); } } else { if (document.activeElement === modalFocusTrap.lastEl) { modalFocusTrap.firstEl.focus(); e.preventDefault(); } } };
    modal.addEventListener('keydown', modalFocusTrap.listener);
    setTimeout(() => modalFocusTrap.firstEl?.focus(), 100);
  }
  
  function closePaymentModal() {
    const pageContainer = document.getElementById('pageContainer');
    if (pageContainer){ pageContainer.removeAttribute('inert'); }
    document.documentElement.style.overflow = ""; document.body.style.overflow = "";
    const { modal } = elements.paymentModal;
    modal.classList.remove('visible');
    if (modalFocusTrap.listener) modal.removeEventListener('keydown', modalFocusTrap.listener);
    setTimeout(() => {
      modal.style.display = 'none';
      currentSelectedItem = null;
      elementToFocusOnModalClose?.focus();
    }, 200);
  }

  // --- FUNGSI UNTUK PRODUK (DARI ACCOUNTS) ---

  function populateAccountCategorySelect() {
    const { customSelect } = elements.accounts;
    const { options, value } = customSelect;
    
    // Ambil kategori unik dari data produk
    const categories = ['Semua Kategori', ...new Set(state.accounts.allData.map(item => item.category))];
    
    options.innerHTML = '';
    value.textContent = state.accounts.activeCategory;
    
    categories.forEach((cat) => {
      const el = document.createElement('div');
      el.className = 'custom-select-option';
      el.textContent = cat;
      el.dataset.value = cat;
      if (cat === state.accounts.activeCategory) el.classList.add('selected');
      el.addEventListener('click', () => {
        value.textContent = cat;
        document.querySelector('#accountCustomSelectOptions .custom-select-option.selected')?.classList.remove('selected');
        el.classList.add('selected');
        toggleCustomSelect(customSelect.wrapper, false);
        state.accounts.activeCategory = cat;
        renderAccountCards();
      });
      options.appendChild(el);
    });
  }
  
  async function parseAccountsSheet(text) {
    const rows = robustCsvParser(text);
    rows.shift(); // Hapus header
    
    // Sesuaikan dengan 5 kolom Anda: Kategori, Harga, Status, Deskripsi, Gambar
    return rows.filter(row => row && row.length >= 5 && row[0]).map(row => ({
      id: `prod_${Date.now()}_${Math.random()}`,
      category: row[0] || 'Lainnya',
      price: Number(row[1]) || 0,
      status: row[2] || 'Tersedia',
      description: row[3] || 'Tidak ada deskripsi.',
      images: (row[4] || '').split(',').map(url => url.trim()).filter(Boolean),
      // Buat judul dari Kategori dan Harga
      title: `${row[0] || 'Produk'} (${formatToIdr(Number(row[1]) || 0)})`, 
    }));
  }
  
  function renderAccountCards() {
    const { cardGrid, cardTemplate, empty } = elements.accounts;
    const filteredAccounts = state.accounts.allData.filter(acc => state.accounts.activeCategory === 'Semua Kategori' || acc.category === state.accounts.activeCategory);
    cardGrid.innerHTML = '';
    empty.style.display = filteredAccounts.length === 0 ? 'flex' : 'none';
    if (filteredAccounts.length === 0) return;
    
    const fragment = document.createDocumentFragment();
    filteredAccounts.forEach(account => {
      const cardClone = cardTemplate.content.cloneNode(true);
      const cardElement = cardClone.querySelector('.account-card');
      const carouselWrapper = cardElement.querySelector('.account-card-carousel-wrapper');
      
      if (account.images.length > 0) {
        const carouselContainer = document.createElement('div');
        carouselContainer.className = 'carousel-container';
        const slides = account.images.map(src => `<div class="carousel-slide"><img src="${src}" alt="Gambar detail untuk ${account.category}" loading="lazy"></div>`).join('');
        const indicators = account.images.map((_, i) => `<button class="indicator-dot" data-index="${i}"></button>`).join('');
        carouselContainer.innerHTML = `<div class="carousel-track">${slides}</div>${account.images.length > 1 ? `<button class="carousel-btn prev" type="button" aria-label="Gambar sebelumnya" disabled><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg></button><button class="carousel-btn next" type="button" aria-label="Gambar selanjutnya"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg></button><div class="carousel-indicators">${indicators}</div>` : ''}`;
        carouselWrapper.appendChild(carouselContainer);
      }
      
      cardElement.querySelector('h3').textContent = formatToIdr(account.price);
      const statusBadge = cardElement.querySelector('.account-status-badge');
      statusBadge.textContent = account.status;
      // Ganti 'tersedia' dan 'habis'
      statusBadge.className = `account-status-badge ${account.status.toLowerCase() === 'tersedia' ? 'available' : 'sold'}`;
      
      const specsContainer = cardElement.querySelector('.account-card-specs');
      // Gunakan formatDescriptionToHTML untuk deskripsi
      specsContainer.innerHTML = formatDescriptionToHTML(account.description);
      
      cardElement.querySelector('.action-btn.buy').addEventListener('click', () => openPaymentModal({ title: account.title, price: account.price, catLabel: 'Produk' }));
      cardElement.querySelector('.action-btn.offer').addEventListener('click', () => window.open(`https://wa.me/${config.waNumber}?text=${encodeURIComponent(`Halo, saya mau bertanya tentang produk: ${account.title}`)}`, '_blank', 'noopener'));
      
      setupExpandableCard(cardElement, '.account-card-main-info');
      fragment.appendChild(cardElement);
    });
    cardGrid.appendChild(fragment);
    initializeCarousels(cardGrid);
  }
  
  async function initializeAccounts() {
    if (state.accounts.initialized) return;
    state.accounts.initialized = true;
    const { cardGrid, error, empty } = elements.accounts;
    error.style.display = 'none'; empty.style.display = 'none';
    cardGrid.innerHTML = ''; // Anda bisa tambahkan skeleton loader di sini jika mau
    
    try {
      const accText = await fetchSheetCached(config.sheets.accounts.name, 'csv');
      state.accounts.allData = await parseAccountsSheet(accText);
      populateAccountCategorySelect();
      renderAccountCards();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Fetch Accounts failed:', err);
      error.textContent = 'Gagal memuat data produk. Coba lagi nanti.';
      error.style.display = 'block';
    }
  }

  // --- INISIALISASI ---
  
  document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    // initializeTestimonialMarquee(); // Dihapus karena section testimonial dihapus
  });
})();

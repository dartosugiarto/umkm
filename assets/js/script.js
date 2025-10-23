(function () {
  'use strict';
  
  const config = {
    sheetId: '10bjcfNHBP6jCnLE87pgk5rXgVS8Qwyu8hc-LXCkdqEE',
    sheets: {
      // Nama sheet Anda harus "Produk"
      products: { name: 'Produk' },
    },
    waNumber: '628XXXXXXXXX', // <-- GANTI NOMOR WA UMKM
    waGreeting: '*Halo, saya mau pesan produk ini:*',
    paymentOptions: [
      { id: 'seabank', name: 'Seabank', feeType: 'fixed', value: 0 },
      { id: 'gopay', name: 'Gopay', feeType: 'fixed', value: 0 },
      { id: 'dana', name: 'Dana', feeType: 'fixed', value: 125 },
      { id: 'bank_to_dana', name: 'Bank ke Dana', feeType: 'fixed', value: 500 },
      { id: 'qris', name: 'Qris', feeType: 'percentage', value: 0.01 },
    ],
  };

  const state = {
    products: {
      initialized: false,
      allData: [],
      activeCategory: 'Semua Kategori',
    },
  };
  
  let currentSelectedItem = null;
  let productsFetchController;
  let modalFocusTrap = { listener: null, focusableEls: [], firstEl: null, lastEl: null };
  let elementToFocusOnModalClose = null;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function getElement(id) {
    return document.getElementById(id);
  }

  const elements = {
    sidebar: {
      nav: getElement('sidebarNav'),
      overlay: getElement('sidebarOverlay'),
      burger: getElement('burgerBtn'),
    },
    navLinks: document.querySelectorAll('[data-mode]'),
    viewProducts: getElement('viewProducts'), // Ganti dari viewAccounts
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
    products: { // Ganti dari accounts
      cardGrid: getElement('productCardGrid'),
      cardTemplate: getElement('productItemTemplate'), // Ganti nama template
      empty: getElement('productEmpty'),
      error: getElement('productError'),
      customSelect: {
        wrapper: getElement('productCustomSelectWrapper'),
        btn: getElement('productCustomSelectBtn'),
        value: getElement('productCustomSelectValue'),
        options: getElement('productCustomSelectOptions'),
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
  
  function updateHeaderStatus() {
    const now = new Date();
    const options = { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false };
    const hour = parseInt(new Intl.DateTimeFormat('en-US', options).format(now), 10);
    const indicator = elements.headerStatusIndicator;
    if (hour >= 8 && hour < 22) {
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
    
    if (elements.products.customSelect.btn) {
      elements.products.customSelect.btn.addEventListener('click', (e) => { e.stopPropagation(); toggleCustomSelect(elements.products.customSelect.wrapper); });
      enhanceCustomSelectKeyboard(elements.products.customSelect.wrapper);
    }

    elements.paymentModal.closeBtn.addEventListener('click', closePaymentModal);
    elements.paymentModal.modal.addEventListener('click', e => { if (e.target === elements.paymentModal.modal) closePaymentModal(); });
    
    document.addEventListener('keydown', (e)=>{ if (e.key==='Escape'){ if (elements.products.customSelect.wrapper) { toggleCustomSelect(elements.products.customSelect.wrapper,false); } } });
    document.addEventListener('click', (e) => {
      if (elements.products.customSelect.wrapper) {
        toggleCustomSelect(elements.products.customSelect.wrapper, false);
      }
    });

    const validModes = ['products'];
    const initialMode = window.location.pathname.substring(1).toLowerCase() || 'products';
    setMode(validModes.includes(initialMode) ? initialMode : 'products', true);

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

  let setMode = function(nextMode, fromPopState = false) {
    if (nextMode !== 'products') nextMode = 'products';

    const viewMap = { products: elements.viewProducts };
    const nextView = viewMap[nextMode];
    if (!nextView) return;

    const pageName = "Katalog Produk";
    
    if (!fromPopState) {
        const search = window.location.search;
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
    
    if (nextMode === 'products' && !state.products.initialized) {
        initializeProducts();
    }
  }

  function calculateFee(price, option) { if (option.feeType === 'fixed') return option.value; if (option.feeType === 'percentage') return Math.ceil(price * option.value); return 0; }
  
  function updatePriceDetails() { const selectedOptionId = document.querySelector('input[name="payment"]:checked')?.value; if (!selectedOptionId) return; const selectedOption = config.paymentOptions.find(opt => opt.id === selectedOptionId); if (!currentSelectedItem || !selectedOption) return; const price = currentSelectedItem.price; const fee = calculateFee(price, selectedOption); const total = price + fee; elements.paymentModal.fee.textContent = formatToIdr(fee); elements.paymentModal.total.textContent = formatToIdr(total); updateWaLink(selectedOption, fee, total); }

  function updateWaLink(option, fee, total) {
    const { catLabel = "Produk", title, price } = currentSelectedItem;
    const text = [
      config.waGreeting,
      `\u203A Kategori: ${catLabel}`,
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

  // --- FUNGSI BARU UNTUK PRODUK ---

  function populateProductCategorySelect() {
    const { customSelect } = elements.products;
    const { options, value } = customSelect;
    
    // Ambil kategori unik dari data produk (Kolom C)
    const categories = ['Semua Kategori', ...new Set(state.products.allData.map(item => item.kategori))];
    
    options.innerHTML = '';
    value.textContent = state.products.activeCategory;
    
    categories.forEach((cat) => {
      const el = document.createElement('div');
      el.className = 'custom-select-option';
      el.textContent = cat;
      el.dataset.value = cat;
      if (cat === state.products.activeCategory) el.classList.add('selected');
      el.addEventListener('click', () => {
        value.textContent = cat;
        document.querySelector('#productCustomSelectOptions .custom-select-option.selected')?.classList.remove('selected');
        el.classList.add('selected');
        toggleCustomSelect(customSelect.wrapper, false);
        state.products.activeCategory = cat;
        renderProductCards();
      });
      options.appendChild(el);
    });
  }
  
  // FUNGSI PARSING BARU UNTUK 9 KOLOM
  async function parseProductsSheet(text) {
    const rows = robustCsvParser(text);
    rows.shift(); // Hapus header
    
    // Baca 9 kolom: NamaProduk, NamaToko, Kategori, HargaDiskon, HargaAsli, Gambar, Rating, JumlahRating, Tags
    return rows.filter(row => row && row.length >= 9 && row[0]).map(row => ({
      namaProduk: row[0] || 'Nama Produk',
      namaToko: row[1] || 'Nama Toko',
      kategori: row[2] || 'Lainnya',
      hargaDiskon: Number(row[3]) || 0,
      hargaAsli: Number(row[4]) || 0,
      gambar: row[5] || '',
      rating: Number(row[6]) || 0,
      jumlahRating: Number(row[7]) || 0,
      tags: (row[8] || '').split(',').map(tag => tag.trim()).filter(Boolean),
    }));
  }
  
  // FUNGSI RENDER BARU UNTUK TAMPILAN LIST
  function renderProductCards() {
    const { cardGrid, cardTemplate, empty } = elements.products;
    const filteredProducts = state.products.allData.filter(p => state.products.activeCategory === 'Semua Kategori' || p.kategori === state.products.activeCategory);
    
    cardGrid.innerHTML = '';
    empty.style.display = filteredProducts.length === 0 ? 'flex' : 'none';
    if (filteredProducts.length === 0) return;
    
    const fragment = document.createDocumentFragment();
    filteredProducts.forEach(product => {
      const cardClone = cardTemplate.content.cloneNode(true);
      const cardElement = cardClone.querySelector('.product-list-item');
      
      // Isi Gambar
      cardElement.querySelector('.product-image').src = product.gambar;
      cardElement.querySelector('.product-image').alt = product.namaProduk;
      
      // Isi Detail
      cardElement.querySelector('.product-title').textContent = product.namaProduk;
      cardElement.querySelector('.product-store-name').textContent = product.namaToko;
      
      // Isi Rating
      const ratingWrapper = cardElement.querySelector('.product-rating-wrapper');
      if (product.rating > 0) {
        cardElement.querySelector('.product-rating-score').textContent = product.rating.toFixed(1);
        cardElement.querySelector('.product-rating-count').textContent = `(${product.jumlahRating})`;
      } else {
        ratingWrapper.style.display = 'none';
      }
      
      // Isi Harga
      const priceWrapper = cardElement.querySelector('.product-price-wrapper');
      cardElement.querySelector('.product-price-diskon').textContent = formatToIdr(product.hargaDiskon);
      if (product.hargaAsli > 0 && product.hargaAsli > product.hargaDiskon) {
        cardElement.querySelector('.product-price-asli').textContent = formatToIdr(product.hargaAsli);
      } else {
        cardElement.querySelector('.product-price-asli').style.display = 'none';
      }
      
      // Isi Tags
      const tagsOnImageContainer = cardElement.querySelector('.product-tags-on-image');
      const tagsBottomContainer = cardElement.querySelector('.product-tags-bottom');
      
      product.tags.forEach(tag => {
        // Cek jika tag berisi "Diskon" atau "%"
        if (tag.toLowerCase().includes('diskon') || tag.includes('%')) {
          const tagEl = document.createElement('span');
          tagEl.className = 'tag-on-image diskon';
          tagEl.textContent = tag.replace(/Diskon /i, ''); // Hapus kata "Diskon"
          tagsOnImageContainer.appendChild(tagEl);
        } else {
          const tagEl = document.createElement('span');
          tagEl.className = 'tag-bottom';
          tagEl.textContent = tag;
          tagsBottomContainer.appendChild(tagEl);
        }
      });
      
      // Tombol Beli
      cardElement.querySelector('.product-buy-btn').addEventListener('click', () => {
        openPaymentModal({
          title: product.namaProduk,
          price: product.hargaDiskon, // Kirim harga diskon ke modal
          catLabel: product.kategori
        });
      });
      
      fragment.appendChild(cardElement);
    });
    cardGrid.appendChild(fragment);
  }
  
  async function initializeProducts() {
    if (state.products.initialized) return;
    state.products.initialized = true;
    const { cardGrid, error, empty } = elements.products;
    error.style.display = 'none'; empty.style.display = 'none';
    cardGrid.innerHTML = ''; // Bisa tambahkan skeleton di sini
    
    try {
      const accText = await fetchSheetCached(config.sheets.products.name, 'csv');
      state.products.allData = await parseProductsSheet(accText);
      populateProductCategorySelect();
      renderProductCards();
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('Fetch Products failed:', err);
      error.textContent = 'Gagal memuat data produk. Coba lagi nanti.';
      error.style.display = 'block';
    }
  }

  // --- INISIALISASI ---
  
  document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
  });
})();

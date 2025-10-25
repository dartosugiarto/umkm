(function(){
  'use strict';

  // === CONFIG (Data tetap di sini untuk kesederhanaan) ===
  const config = {
    sheetId: '10bjcfNHBP6jCnLE87pgk5rXgVS8Qwyu8hc-LXCkdqEE',
    sheets: { accounts: { name: 'Produk' } },
    waNumber: '628XXXXXXXXX', // GANTI DENGA0N NOMOR ANDA
    waGreeting: '*Halo, saya mau pesan:*',
    flashSale: {
      enabled: true,
      start: '2025-10-20T08:00:00+07:00', // Sesuaikan tanggal
      end:   '2025-10-30T22:00:00+07:00', // Sesuaikan tanggal
      discountPercent: 20,
      categories: ['Semua']
    },
    coupons: [
      { code: 'KENYANG10', type: 'percent', value: 10, minSubtotal: 50000, note: 'Diskon 10% min 50k' }
    ],
    freeShipping: { threshold: 150000 },
    paymentOptions: [
      { id: 'seabank', name: 'Seabank', feeType: 'fixed', value: 0 },
      { id: 'gopay', name: 'Gopay', feeType: 'fixed', value: 0 },
      { id: 'dana', name: 'Dana', feeType: 'fixed', value: 125 },
      { id: 'bank_to_dana', name: 'Bank ke Dana', feeType: 'fixed', value: 500 },
      { id: 'qris', name: 'Qris', feeType: 'percentage', value: 0.01 },
    ]
  };

  // === STATE & ELEMENTS ===
  const state = {
    accounts: { initialized:false, allData:[] },
    activeCoupon: null,
    cart: [], // STATE BARU: Keranjang Belanja
    activePayment: config.paymentOptions[0].id,
  };

  const $ = (id)=>document.getElementById(id);
  const els = {
    // Navigasi Halaman
    sidebarNav: $('sidebarNav'),
    sidebarOverlay: $('sidebarOverlay'),
    burgerBtn: $('burgerBtn'),
    pageContainer: $('pageContainer'),
    catalogPage: $('catalogPage'),
    promoPage: $('promoPage'),
    
    // Katalog
    productList: $('productList'),
    productEmpty: $('productEmpty'),
    
    // Promo
    promoList: $('promoList'),
    promoEmpty: $('promoEmpty'),
    
    // Header
    headerStatusIndicator: $('headerStatusIndicator'),
    cartBtn: $('cartBtn'),
    cartCountBadge: $('cartCountBadge'),
    
    // Keranjang (Sheet)
    cartSheet: $('cartSheet'),
    closeSheetBtn: $('closeSheetBtn'),
    cartItemsList: $('cartItemsList'),
    cartEmpty: $('cartEmpty'),
    paymentOptionsContainer: $('paymentOptionsContainer'),
    cartSubtotal: $('cartSubtotal'),
    cartDiscountRow: $('cartDiscountRow'),
    cartDiscountCode: $('cartDiscountCode'),
    cartDiscountAmount: $('cartDiscountAmount'),
    cartFee: $('cartFee'),
    cartTotal: $('cartTotal'),
    continueToWaBtn: $('continueToWaBtn'),
    
    // Lain-lain
    toast: $('toast'),
  };

  // === HELPERS ===
  const formatToIdr = (v)=> new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(v);
  const getSheetUrl = (sheetName, format='json') => {
    const base = `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq`;
    const enc = encodeURIComponent(sheetName);
    return format==='csv'? `${base}?tqx=out:csv&sheet=${enc}` : `${base}?sheet=${enc}&tqx=out:json`;
  };
  function robustCsvParser(text){
    const t = text.trim().replace(/\r\n/g,'\n');
    return t.split('\n').map(line=>{
      const cells=[]; let f='',q=false;
      for(let i=0;i<line.length;i++){
        const ch=line[i];
        if(q){ if(ch === '"'){ if(i+1<line.length && line[i+1] === '"'){ f+='"'; i++; } else q=false; } else f+=ch; }
        else { if(ch === '"') q=true; else if(ch === ','){ cells.push(f); f=''; } else f+=ch; }
      }
      cells.push(f); return cells;
    });
  }
  const toast = (msg)=>{ const t=els.toast; if(!t) return; t.textContent=msg; t.classList.add('show'); setTimeout(()=> t.classList.remove('show'), 1800); };
  const isOpen = ()=>{
    const hour = parseInt(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Jakarta',hour:'2-digit',hour12:false}).format(new Date()),10);
    return hour>=8 && hour<22;
  };
  function updateHeaderStatus(){
    const open = isOpen();
    els.headerStatusIndicator.textContent = open?'BUKA':'TUTUP';
    els.headerStatusIndicator.className = `status-badge ${open?'success':'closed'}`;
  }

  // === DATA FETCHING ===
  async function fetchSheetCached(sheetName, format='csv'){
    const url = getSheetUrl(sheetName, format==='csv'?'csv':'json');
    const key = `pp_cache_${sheetName}_${format}`;
    const cached = sessionStorage.getItem(key);
    if(cached){ try{ fetch(url).then(r=>r.text()).then(t=>sessionStorage.setItem(key,t)); }catch{}; return cached; }
    const res = await fetch(url);
    if(!res.ok) throw new Error(`Network error: ${res.statusText}`);
    const text = await res.text();
    sessionStorage.setItem(key, text);
    return text;
  }

  function parseAccountsSheet(text){
    const rows = robustCsvParser(text);
    rows.shift(); // header
    return rows.filter(r=>r && r.length>=5 && r[0]).map((r, index)=>{
      const category = r[0] || 'Lainnya';
      const price = Number(r[1]) || 0;
      const status = r[2] || 'Tersedia';
      const description = r[3] || '';
      const images = (r[4]||'').split(',').map(u=>u.trim()).filter(Boolean);
      const stock = r.length>5 ? Math.max(0, parseInt(r[5]||'0',10)) : null;
      const compareAt = r.length>6 ? Math.max(price, parseInt(r[6]||'0',10)) : null;
      const flashSale = r.length>7 ? String(r[7]).trim().toLowerCase() === 'true' : false;
      const title = `${category} (${formatToIdr(price)})`;
      return { id:`prod_${index}`, category, price, status, description, images, stock, compareAt, flashSale, title };
    });
  }

  // === PRICING & PROMO ===
  function flashActive(){
    if(!config.flashSale.enabled) return false;
    const n = new Date();
    return n >= new Date(config.flashSale.start) && n <= new Date(config.flashSale.end);
  }
  
  function getDiscountPrice(item) {
    if (flashActive() && item.flashSale) {
      const discount = Math.round(item.price * (config.flashSale.discountPercent / 100));
      return Math.max(0, item.price - discount);
    }
    return item.price;
  }

  function applyCoupon(subtotal){
    const c = state.activeCoupon?.code && config.coupons.find(k=>k.code===state.activeCoupon.code);
    if(!c) return { code:null, discount:0, label:'' };
    if(subtotal < (c.minSubtotal||0)) return { code:c.code, discount:0, label:`Min. belanja ${formatToIdr(c.minSubtotal)}` };
    let d = 0; if(c.type==='percent') d=Math.floor(subtotal*(c.value/100)); else if(c.type==='fixed') d=c.value;
    return { code:c.code, discount:d, label:c.note||'' };
  }
  
  function calculateFee(price, option){ 
    if(option.feeType==='fixed') return option.value; 
    if(option.feeType==='percentage') return Math.ceil(price * option.value); 
    return 0; 
  }
  
  // === RENDER: PRODUCT LIST (Utama) ===
  
  // --- FUNGSI ANIMASI BARU ---
  function animateItemToCart(cardElement) {
    if (!cardElement) return;

    // 1. Dapatkan posisi elemen produk dan ikon keranjang
    const productRect = cardElement.getBoundingClientRect();
    const cartRect = els.cartBtn.getBoundingClientRect();

    // 2. Buat elemen klon untuk animasi
    const flyingItem = cardElement.cloneNode(true);
    flyingItem.style.position = 'fixed';
    flyingItem.style.left = `${productRect.left}px`;
    flyingItem.style.top = `${productRect.top}px`;
    flyingItem.style.width = `${productRect.width}px`;
    flyingItem.style.height = `${productRect.height}px`;
    flyingItem.style.borderRadius = `var(--radius)`;
    flyingItem.style.overflow = 'hidden';
    flyingItem.style.pointerEvents = 'none';
    flyingItem.style.transition = 'none';
    flyingItem.style.animation = 'none';

    document.body.appendChild(flyingItem);

    // 3. Hitung transformasi
    const targetX = cartRect.left + (cartRect.width / 2) - (productRect.width / 2);
    const targetY = cartRect.top + (cartRect.height / 2) - (productRect.height / 2);

    // Set CSS variabel untuk keyframe animasi
    flyingItem.style.setProperty('--fly-x', `${targetX - productRect.left}px`);
    flyingItem.style.setProperty('--fly-y', `${targetY - productRect.top}px`);

    // 4. Trigger animasi
    flyingItem.style.animation = 'flyToCart .7s forwards cubic-bezier(0.5, 0, 0.7, 0.4)';

    // 5. Animasi ikon keranjang
    els.cartBtn.classList.add('cart-icon-bump');

    // 6. Hapus elemen klon setelah animasi selesai
    flyingItem.addEventListener('animationend', () => {
      flyingItem.remove();
      // Hapus kelas bump setelah animasi selesai
      els.cartBtn.classList.remove('cart-icon-bump');
    });
  }

  // --- FUNGSI INI DIMODIFIKASI ---
  function renderProductList(items){
    const list = els.productList;
    list.innerHTML='';
    if(!items.length){ els.productEmpty.style.display='flex'; return; }
    els.productEmpty.style.display='none';
    
    const onFlashSale = flashActive();

    items.forEach(acc=>{
      const currentPrice = getDiscountPrice(acc);
      const isOnSale = currentPrice < acc.price;
      const comparePrice = acc.compareAt && acc.compareAt > currentPrice ? acc.compareAt : (isOnSale ? acc.price : null);
      
      const img = acc.images[0] || '';
      
      const card = document.createElement('div');
      card.className='prod-card';
      card.innerHTML = `
        <img class="prod-thumb" src="${img}" alt="Foto ${acc.category}">
        <div class="prod-main">
          <div class="prod-title">${acc.category}</div>
          <div class="prod-meta"><span class="star">★</span>4.8 • 1k+ ulasan</div>
          <div class="prod-price-row">
            <span class="prod-price">${formatToIdr(currentPrice)}</span>
            ${comparePrice ? `<span class="prod-compare">${formatToIdr(comparePrice)}</span>` : ''}
          </div>
          <div class="prod-badges">
            ${onFlashSale && acc.flashSale ? `<span class="badge">Flash Sale -${config.flashSale.discountPercent}%</span>`:''}
            ${(comparePrice && !isOnSale) ? `<span class="badge">Hemat ${formatToIdr(comparePrice - currentPrice)}</span>` : ''}
          </div>
          <div class="action-row">
            <button class="btn btn-primary" data-id="${acc.id}">Tambah</button>
            <button class="btn btn-ghost" data-id="${acc.id}">Tanya</button>
          </div>
        </div>
      `;
      // --- Event Listeners (DIMODIFIKASI) ---
      const primaryBtn = card.querySelector('.btn.btn-primary');
      const ghostBtn = card.querySelector('.btn.btn-ghost');
      
      primaryBtn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const product = state.accounts.allData.find(p => p.id === id);
        if (product) {
          addToCart(product);
          // toast(`${product.category} ditambah ke keranjang`); // <-- Dihapus
          animateItemToCart(card); // <-- Diganti dengan ini
        }
      });
      
      ghostBtn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const product = state.accounts.allData.find(p => p.id === id);
        if (product) {
          window.open(`https://wa.me/${config.waNumber}?text=${encodeURIComponent(`Halo, tanya ${product.title}`)}`,'_blank','noopener');
        }
      });
      
      list.appendChild(card);
    });
  }

  // === RENDER: PROMO PAGE (FUNGSI INI DIGANTI TOTAL) ===
  function renderPromoPage(){
    const list = els.promoList;
    list.innerHTML='';
    const items = [
      ...config.coupons.map(c=>({ title: c.note, desc: `Min. ${formatToIdr(c.minSubtotal)}`, code: c.code })),
      { title: 'Gratis Ongkir', desc: `Otomatis, min. ${formatToIdr(config.freeShipping.threshold)}`, code: null }
    ];

    if (!items.length) {
      els.promoEmpty.style.display = 'flex';
      return;
    }
    els.promoEmpty.style.display = 'none';

    items.forEach(p=>{
      const div=document.createElement('div');
      div.className='promo-item';
      // Set status aktif jika cocok dengan state
      if (state.activeCoupon && state.activeCoupon.code === p.code) {
        div.classList.add('active');
      }
      
      div.innerHTML = `
        <div class="promo-info">
          <span class="title">${p.title}</span>
          <span class="desc">${p.desc}</span>
        </div>
        ${p.code ? `<span class="promo-code">${p.code}</span>` : ''}
      `;
      
      if (p.code) {
        div.addEventListener('click', ()=>{
          const currentlyActive = div.classList.contains('active');
          
          // 1. Hapus semua status aktif
          list.querySelectorAll('.promo-item').forEach(item => item.classList.remove('active'));
          
          if (currentlyActive) {
            // 2. Jika diklik saat aktif, batalkan
            state.activeCoupon = null; 
            toast(`Voucher dibatalkan`);
          } else {
            // 3. Jika diklik saat non-aktif, aktifkan
            div.classList.add('active'); // Tambah feedback visual
            state.activeCoupon = { code: p.code }; 
            toast(`Kode ${p.code} diaktifkan`);
          }
          
          updateCartSummary(); // Update cart jika sedang dibuka
        });
      }
      list.appendChild(div);
    });
  }

  // === RENDER: PAYMENT OPTIONS (di dalam keranjang) ===
  function renderPaymentOptions() {
    els.paymentOptionsContainer.innerHTML = '';
    config.paymentOptions.forEach((opt,i)=>{
      // Hitung fee awal berdasarkan subtotal 0, akan di-update
      const fee = calculateFee(0, opt); 
      els.paymentOptionsContainer.insertAdjacentHTML('beforeend', `
        <div class="payment-option">
          <input type="radio" id="${opt.id}" name="payment" value="${opt.id}" ${i===0?'checked':''}>
          <label for="${opt.id}" tabindex="0">${opt.name} <span style="float:right;">+ ${formatToIdr(fee)}</span></label>
        </div>`);
    });
    // Tambah event listener
    els.paymentOptionsContainer.querySelectorAll('input[name="payment"]').forEach(inp=> inp.addEventListener('change', (e) => {
      state.activePayment = e.target.value;
      updateCartSummary();
    }));
  }

  // === CART (KERANJANG) LOGIC ===
  
  function addToCart(item) {
    const existingItem = state.cart.find(cartItem => cartItem.id === item.id);
    if (existingItem) {
      existingItem.quantity += 1;
    } else {
      state.cart.push({ ...item, quantity: 1 });
    }
    updateCart();
  }
  
  function updateCartItemQuantity(id, change) {
    const item = state.cart.find(cartItem => cartItem.id === id);
    if (!item) return;
    
    item.quantity += change;
    
    if (item.quantity <= 0) {
      // Hapus item dari keranjang
      state.cart = state.cart.filter(cartItem => cartItem.id !== id);
    }
    updateCart();
  }
  
  function updateCart() {
    renderCartItems();
    updateCartSummary();
  }
  
  function renderCartItems() {
    els.cartItemsList.innerHTML = '';
    if (!state.cart.length) {
      els.cartEmpty.style.display = 'block';
      els.cartCountBadge.textContent = '0';
      return;
    }
    
    els.cartEmpty.style.display = 'none';
    let totalItems = 0;
    
    state.cart.forEach(item => {
      totalItems += item.quantity;
      const currentPrice = getDiscountPrice(item);
      const img = item.images[0] || '';
      
      const itemEl = document.createElement('div');
      itemEl.className = 'cart-item';
      itemEl.innerHTML = `
        <img class="cart-item-thumb" src="${img}" alt="${item.category}">
        <div class="cart-item-info">
          <div class="title">${item.category}</div>
          <div class="price">${item.quantity} x ${formatToIdr(currentPrice)}</div>
        </div>
        <div class="cart-item-actions">
          <button class="qty-btn" data-id="${item.id}" data-change="-1" aria-label="Kurangi">-</button>
          <span class="qty-text">${item.quantity}</span>
          <button class="qty-btn" data-id="${item.id}" data-change="1" aria-label="Tambah">+</button>
          <button class="remove-btn" data-id="${item.id}" data-change="0" aria-label="Hapus">&times;</button>
        </div>
      `;
      els.cartItemsList.appendChild(itemEl);
    });
    
    // Update badge di header
    els.cartCountBadge.textContent = totalItems;
  }
  
  function updateCartSummary() {
    const paymentOption = config.paymentOptions.find(p => p.id === state.activePayment);
    if (!paymentOption) return;

    // 1. Hitung Subtotal
    const subtotal = state.cart.reduce((total, item) => {
      return total + (getDiscountPrice(item) * item.quantity);
    }, 0);
    els.cartSubtotal.textContent = formatToIdr(subtotal);

    // 2. Hitung Diskon
    const couponRes = applyCoupon(subtotal);
    if (couponRes.discount > 0) {
      els.cartDiscountRow.style.display = 'flex';
      els.cartDiscountCode.textContent = couponRes.code;
      els.cartDiscountAmount.textContent = `- ${formatToIdr(couponRes.discount)}`;
    } else {
      els.cartDiscountRow.style.display = 'none';
    }
    const afterCoupon = Math.max(0, subtotal - couponRes.discount);

    // 3. Hitung Fee
    const fee = calculateFee(afterCoupon, paymentOption);
    els.cartFee.textContent = formatToIdr(fee);
    
    // Update label fee di opsi pembayaran
    els.paymentOptionsContainer.querySelectorAll('label').forEach(label => {
      const optId = label.getAttribute('for');
      const opt = config.paymentOptions.find(o => o.id === optId);
      if(opt) {
        const reCalcFee = calculateFee(afterCoupon, opt);
        label.querySelector('span').textContent = `+ ${formatToIdr(reCalcFee)}`;
      }
    });

    // 4. Hitung Total
    const total = afterCoupon + fee;
    els.cartTotal.textContent = formatToIdr(total);
    
    // 5. Update Tombol WA
    els.continueToWaBtn.href = `https://wa.me/${config.waNumber}?text=${encodeURIComponent(buildCartWAText({
      subtotal, couponRes, fee, total, paymentOption
    }))}`;
  }
  
  function buildCartWAText({ subtotal, couponRes, fee, total, paymentOption }) {
    const parts = [config.waGreeting];
    
    // Daftar Item
    state.cart.forEach(item => {
      parts.push(`\n- ${item.category} (x${item.quantity})`);
      parts.push(`  ${formatToIdr(getDiscountPrice(item) * item.quantity)}`);
    });
    
    // Rincian Biaya
    parts.push("\n*Rincian:*");
    parts.push(`Subtotal: ${formatToIdr(subtotal)}`);
    if (couponRes.discount > 0) {
      parts.push(`Diskon (${couponRes.code}): -${formatToIdr(couponRes.discount)}`);
    }
    parts.push(`Pembayaran: ${paymentOption.name}`);
    parts.push(`Biaya Transaksi: ${formatToIdr(fee)}`);
    parts.push(`\n*Total: ${formatToIdr(total)}*`);
    
    return parts.join('\n');
  }

  // === CART SHEET (Modal) VISIBILITY ===
  function openCartSheet() {
    updateCart(); // Selalu update saat dibuka
    els.cartSheet.style.display = 'flex';
    setTimeout(() => els.cartSheet.classList.add('visible'), 10);
  }
  function closeCartSheet() {
    els.cartSheet.classList.remove('visible');
    setTimeout(() => els.cartSheet.style.display = 'none', 300);
  }

  // === PAGE NAVIGATION (FUNGSI INI DIGANTI TOTAL) ===
  function showPage(pageId) {
    const allPages = document.querySelectorAll('.page-section');
    const pageToShow = $(pageId);

    allPages.forEach(page => {
      if (page.id === pageId) {
        // Tampilkan halaman baru
        page.style.display = 'block';
        page.classList.remove('is-hiding');
      } else if (page.style.display === 'block' && !page.classList.contains('is-hiding')) {
        // Sembunyikan halaman lama dengan animasi
        page.classList.add('is-hiding');
        // Set display:none HANYA setelah animasi selesai
        setTimeout(() => {
          page.style.display = 'none';
        }, 200); // Durasi harus cocok dengan animasi fadeOut di CSS
      }
    });

    // Update status aktif di sidebar
    els.sidebarNav.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.page === pageId) {
        item.classList.add('active');
      }
    });
    // Tutup sidebar
    document.body.classList.remove('sidebar-open');
  }
  
  // === ORG JSON-LD ===
  function injectOrgJsonLd(){
    const el = document.getElementById('orgJsonLd'); if(!el) return;
    const data = {"@context":"https://schema.org","@type":"Organization","name":"Sambal Bejo","url":location.origin,"logo":location.origin + "/assets/images/logo.png","sameAs":[]};
    el.textContent = JSON.stringify(data);
  }

  // === INIT ===
  async function initialize(){
    updateHeaderStatus(); setInterval(updateHeaderStatus, 60_000);
    
    // Muat data produk
    try{
      const txt = await fetchSheetCached(config.sheets.accounts.name, 'csv');
      state.accounts.allData = parseAccountsSheet(txt);
      renderProductList(state.accounts.allData);
    }catch(e){
      console.error(e);
      els.productEmpty.style.display='flex';
    }
    
    // Render bagian yang statis
    renderPromoPage();
    renderPaymentOptions();
    injectOrgJsonLd();

    // --- Wire Event Listeners ---
    
    // Navigasi Sidebar
    els.burgerBtn.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-open');
    });
    els.sidebarOverlay.addEventListener('click', () => {
      document.body.classList.remove('sidebar-open');
    });
    els.sidebarNav.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        showPage(e.currentTarget.dataset.page);
      });
    });
    
    // Keranjang (Sheet)
    els.cartBtn.addEventListener('click', openCartSheet);
    els.closeSheetBtn.addEventListener('click', closeCartSheet);
    els.cartSheet.addEventListener('click', (e) => {
      if(e.target === els.cartSheet) closeCartSheet();
    });
    
    // Aksi di dalam keranjang (Tambah/Kurang/Hapus)
    els.cartItemsList.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      
      const { id, change } = button.dataset;
      if (!id || !change) return;
      
      updateCartItemQuantity(id, parseInt(change, 10));
    });
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();

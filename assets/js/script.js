
(function(){
  'use strict';

  // === CONFIG (minimal, tetap bisa pakai voucher & WA) ===
  const config = {
    sheetId: '10bjcfNHBP6jCnLE87pgk5rXgVS8Qwyu8hc-LXCkdqEE',
    sheets: { accounts: { name: 'Produk' } },
    waNumber: '628XXXXXXXXX',
    waGreeting: '*Halo, saya mau pesan produk ini:*',
    flashSale: {
      enabled: true,
      start: '2025-10-20T08:00:00+07:00',
      end:   '2025-10-30T22:00:00+07:00',
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
  };
  const $ = (id)=>document.getElementById(id);
  const els = {
    flashDealsRow: $('flashDealsRow'),
    dealsCountdown: $('dealsCountdown'),
    productList: $('productList'),
    empty: $('accountEmpty'),
    headerStatusIndicator: $('headerStatusIndicator'),
    promoDeadlineText: $('promoDeadlineText'),
    activeCouponCode: $('activeCouponCode'),
    freeShipText: $('freeShipText'),
    paymentModal: {
      modal:$('paymentModal'), closeBtn:$('closeModalBtn'),
      itemName:$('modalItemName'), itemPrice:$('modalItemPrice'),
      optionsContainer:$('paymentOptionsContainer'), fee:$('modalFee'),
      total:$('modalTotal'), waBtn:$('continueToWaBtn'), appliedPromo:$('modalAppliedPromo')
    },
    toast: $('toast'),
    promoList: $('promoList')
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

  // === DATA ===
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
    return rows.filter(r=>r && r.length>=5 && r[0]).map(r=>{
      const category = r[0] || 'Lainnya';
      const price = Number(r[1]) || 0;
      const status = r[2] || 'Tersedia';
      const description = r[3] || '';
      const images = (r[4]||'').split(',').map(u=>u.trim()).filter(Boolean);
      const stock = r.length>5 ? Math.max(0, parseInt(r[5]||'0',10)) : null;
      const compareAt = r.length>6 ? Math.max(price, parseInt(r[6]||'0',10)) : null;
      const flashSale = r.length>7 ? String(r[7]).trim().toLowerCase() === 'true' : false;
      const title = `${category} (${formatToIdr(price)})`;
      return { id:`prod_${Date.now()}_${Math.random()}`, category, price, status, description, images, stock, compareAt, flashSale, title };
    });
  }

  // === PRICING & PROMO ===
  function flashActive(){
    if(!config.flashSale.enabled) return false;
    const n = new Date();
    return n >= new Date(config.flashSale.start) && n <= new Date(config.flashSale.end);
  }
  function getFlashDiscount(price, categoryOrFlag){
    if(!flashActive()) return 0;
    // jika produk ditandai flashSale TRUE, selalu diskon
    if(categoryOrFlag === true) return Math.round(price * (config.flashSale.discountPercent/100));
    // fallback by category 'Semua'
    const cats = config.flashSale.categories;
    if(cats.includes('Semua')) return Math.round(price * (config.flashSale.discountPercent/100));
    return 0;
  }
  function renderCountdown(el, deadline){
    function tick(){
      const diff = new Date(deadline) - new Date();
      if(diff<=0){ el.textContent='Selesai'; clearInterval(t); return; }
      const h=Math.floor(diff/3_600_000), m=Math.floor((diff%3_600_000)/60_000), s=Math.floor((diff%60_000)/1000);
      el.textContent = `${h}j ${m}m ${s}d`;
    }
    tick(); const t=setInterval(tick,1000);
  }

  // === RENDER: FLASH DEALS ===
  function renderFlashDeals(items){
    const row = els.flashDealsRow;
    row.innerHTML='';
    const deals = items.filter(x=> x.flashSale === true);
    if(!deals.length){ document.getElementById('flashDealsSection').style.display='none'; return; }
    deals.forEach(acc=>{
      const discount = getFlashDiscount(acc.price, true);
      const discountedPrice = Math.max(0, acc.price - discount);
      const offPct = acc.compareAt && acc.compareAt>discountedPrice
        ? Math.round((acc.compareAt - discountedPrice)/acc.compareAt*100)
        : (discount ? config.flashSale.discountPercent : 0);
      const div = document.createElement('div');
      div.className='deal-card';
      const img = acc.images[0] || '';
      div.innerHTML = `
        <img class="deal-thumb" src="${img}" alt="Foto ${acc.category}">
        <div class="deal-info">
          <div class="deal-title">${acc.category}</div>
          <div class="deal-price">
            <span class="now">${formatToIdr(discount ? discountedPrice : acc.price)}</span>
            <span class="was">${formatToIdr(acc.compareAt || acc.price)}</span>
          </div>
          <div class="deal-badges">
            ${offPct ? `<span class="badge-off">-${offPct}%</span>` : ''}
          </div>
          <div class="action-row">
            <button class="btn btn-primary">Beli</button>
            <button class="btn btn-ghost">Tanya</button>
          </div>
        </div>`;
      // actions
      div.querySelector('.btn.btn-primary').addEventListener('click', ()=> openPaymentModal({
        title: acc.title, price: acc.price, discounted: discount? discountedPrice : (acc.compareAt? Math.min(acc.compareAt, acc.price): acc.price), catLabel:'Produk'
      }));
      div.querySelector('.btn.btn-ghost').addEventListener('click', ()=> window.open(`https://wa.me/${config.waNumber}?text=${encodeURIComponent(`Halo, tanya ${acc.title}`)}`,'_blank','noopener'));
      row.appendChild(div);
    });
    // countdown at header
    if(flashActive()) renderCountdown(els.dealsCountdown, config.flashSale.end);
    else els.dealsCountdown.textContent='';
  }

  // === RENDER: PRODUCT LIST HORIZONTAL (dummy rating only) ===
  function randomRating(){ return (Math.random()*0.4 + 4.5).toFixed(1); } // 4.5 - 4.9
  function randomReviews(){ return Math.floor(Math.random()*600) + 200; } // 200 - 799

  function renderProductList(items){
    const list = els.productList;
    list.innerHTML='';
    const data = items; // tampilkan semua; flash sale juga boleh muncul di bawah jika mau, atau filter
    if(!data.length){ els.empty.style.display='flex'; return; }
    els.empty.style.display='none';
    data.forEach(acc=>{
      const discount = getFlashDiscount(acc.price, acc.flashSale===true);
      const discountedPrice = Math.max(0, acc.price - discount);
      const img = acc.images[0] || '';
      const rating = randomRating();
      const reviews = randomReviews();

      const card = document.createElement('div');
      card.className='prod-card';
      card.innerHTML = `
        <img class="prod-thumb" src="${img}" alt="Foto ${acc.category}">
        <div class="prod-main">
          <div class="prod-title">${acc.category}</div>
          <div class="prod-meta"><span class="star">★</span>${rating} • ${reviews}+ ulasan</div>
          <div class="prod-price-row">
            <span class="prod-price">${formatToIdr(discount ? discountedPrice : acc.price)}</span>
            ${(acc.compareAt && (acc.compareAt > (discount? discountedPrice: acc.price))) ? `<span class="prod-compare">${formatToIdr(acc.compareAt)}</span>` : ''}
          </div>
          <div class="prod-badges">
            ${discount? `<span class="badge">Flash Sale -${config.flashSale.discountPercent}%</span>`:''}
            ${(acc.compareAt && (acc.compareAt > (discount? discountedPrice: acc.price))) ? `<span class="badge">Hemat ${formatToIdr((acc.compareAt - (discount? discountedPrice: acc.price)))}</span>` : ''}
          </div>
          <div class="action-row">
            <button class="btn btn-primary">Beli</button>
            <button class="btn btn-ghost">Tanya</button>
          </div>
        </div>
      `;
      card.querySelector('.btn.btn-primary').addEventListener('click', ()=> openPaymentModal({
        title: acc.title, price: acc.price, discounted: discount? discountedPrice : acc.price, catLabel:'Produk'
      }));
      card.querySelector('.btn.btn-ghost').addEventListener('click', ()=> window.open(`https://wa.me/${config.waNumber}?text=${encodeURIComponent(`Halo, tanya ${acc.title}`)}`,'_blank','noopener'));
      list.appendChild(card);
    });
  }

  // === PAYMENT MODAL (reused) ===
  let currentSelectedItem=null;
  function calculateFee(price, option){ if(option.feeType==='fixed') return option.value; if(option.feeType==='percentage') return Math.ceil(price * option.value); return 0; }
  function applyCoupon(subtotal){
    const c = state.activeCoupon?.code && config.coupons.find(k=>k.code===state.activeCoupon.code);
    if(!c) return { code:null, discount:0, label:'' };
    if(subtotal < (c.minSubtotal||0)) return { code:c.code, discount:0, label:`Min. belanja ${formatToIdr(c.minSubtotal)}` };
    let d = 0; if(c.type==='percent') d=Math.floor(subtotal*(c.value/100)); else if(c.type==='fixed') d=c.value;
    return { code:c.code, discount:d, label:c.note||'' };
  }
  function buildWAText({catLabel='Produk', title, price, discounted, paymentOption, fee, total}){
    const parts=[
      config.waGreeting,
      `\u203A Tipe: ${catLabel}`,
      `\u203A Item: ${title}`,
      discounted && discounted < price ? `\u203A Harga Asli: ${formatToIdr(price)}` : null,
      `\u203A Harga: ${formatToIdr(discounted && discounted < price ? discounted : price)}`,
      state.activeCoupon?.code ? `\u203A Kode Voucher: ${state.activeCoupon.code}` : null,
      `\u203A Pembayaran: ${paymentOption.name}`,
      `\u203A Fee: ${formatToIdr(fee)}`,
      `\u203A Total: ${formatToIdr(total)}`,
    ].filter(Boolean);
    return parts.join('\n');
  }
  function openPaymentModal(item){
    currentSelectedItem = item;
    const base = item.discounted && item.discounted < item.price ? item.discounted : item.price;
    els.paymentModal.itemName.textContent = item.title;
    els.paymentModal.itemPrice.textContent = (item.discounted && item.discounted < item.price)
      ? `${formatToIdr(item.discounted)} (Asli ${formatToIdr(item.price)})`
      : formatToIdr(item.price);
    // options
    els.paymentModal.optionsContainer.innerHTML='';
    config.paymentOptions.forEach((opt,i)=>{
      const fee = calculateFee(base, opt);
      els.paymentModal.optionsContainer.insertAdjacentHTML('beforeend', `
        <div class="payment-option">
          <input type="radio" id="${opt.id}" name="payment" value="${opt.id}" ${i===0?'checked':''}>
          <label for="${opt.id}" tabindex="0">${opt.name} <span style="float:right;">+ ${formatToIdr(fee)}</span></label>
        </div>`);
    });
    els.paymentModal.optionsContainer.querySelectorAll('input[name="payment"]').forEach(inp=> inp.addEventListener('change', updatePriceDetails));
    els.paymentModal.modal.style.display='flex';
    setTimeout(()=> els.paymentModal.modal.classList.add('visible'), 10);
    updatePriceDetails();
  }
  function updatePriceDetails(){
    const selectedId = document.querySelector('input[name="payment"]:checked')?.value;
    if(!selectedId || !currentSelectedItem) return;
    const opt = config.paymentOptions.find(o=>o.id===selectedId);
    const base = currentSelectedItem.discounted && currentSelectedItem.discounted < currentSelectedItem.price ? currentSelectedItem.discounted : currentSelectedItem.price;
    const couponRes = applyCoupon(base);
    const afterCoupon = Math.max(0, base - couponRes.discount);
    const fee = calculateFee(afterCoupon, opt);
    const total = afterCoupon + fee;
    els.paymentModal.fee.textContent = formatToIdr(fee);
    els.paymentModal.total.textContent = formatToIdr(total);
    els.paymentModal.appliedPromo.textContent = couponRes.code ? `Voucher ${couponRes.code} terpakai (${couponRes.label})` : '';
    els.paymentModal.waBtn.href = `https://wa.me/${config.waNumber}?text=${encodeURIComponent(buildWAText({
      catLabel: currentSelectedItem.catLabel, title: currentSelectedItem.title, price: currentSelectedItem.price,
      discounted: base, paymentOption: opt, fee, total
    }))}`;
  }
  function closePaymentModal(){
    els.paymentModal.modal.classList.remove('visible');
    setTimeout(()=> { els.paymentModal.modal.style.display='none'; currentSelectedItem=null; }, 200);
  }

  // === PROMO PAGE (minimal) ===
  function renderPromoPage(){
    const list = document.getElementById('promoList');
    if(!list) return;
    list.innerHTML='';
    const frag = document.createDocumentFragment();
    const items = [
      ...config.coupons.map(c=>({ title:`Kode: ${c.code}`, price: c.type==='percent' ? `${c.value}%` : `Rp${c.value}`, desc: c.note || '-', code: c.code })),
      { title: 'Gratis Ongkir', price: `≥ ${formatToIdr(config.freeShipping.threshold)}`, desc: 'Otomatis saat total memenuhi syarat', code: null }
    ];
    items.forEach(p=>{
      const div=document.createElement('div');
      div.className='list-item';
      div.innerHTML = `<span class="title">${p.title}</span><span class="price">${p.price}</span>`;
      div.addEventListener('click', ()=>{
        if(p.code){ state.activeCoupon = { code:p.code }; toast(`Kode ${p.code} diaktifkan`); document.getElementById('activeCouponCode').textContent=p.code; }
      });
      frag.appendChild(div);
    });
    list.appendChild(frag);
  }

  // === ORG JSON-LD ===
  function injectOrgJsonLd(){
    const el = document.getElementById('orgJsonLd'); if(!el) return;
    const data = {"@context":"https://schema.org","@type":"Organization","name":"Nama UMKM","url":location.origin,"logo":location.origin + "/assets/images/logo.png","sameAs":[]};
    el.textContent = JSON.stringify(data);
  }

  // === INIT ===
  async function initialize(){
    updateHeaderStatus(); setInterval(updateHeaderStatus, 60_000);
    // promo bar meta
    document.getElementById('promoDeadlineText').textContent =
      new Date(config.flashSale.end).toLocaleString('id-ID',{ timeZone:'Asia/Jakarta', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    document.getElementById('activeCouponCode').textContent = config.coupons[0]?.code || '-';
    document.getElementById('freeShipText').textContent = formatToIdr(config.freeShipping.threshold);

    try{
      const txt = await fetchSheetCached(config.sheets.accounts.name, 'csv');
      state.accounts.allData = parseAccountsSheet(txt);
      renderFlashDeals(state.accounts.allData);
      renderProductList(state.accounts.allData);
    }catch(e){
      console.error(e);
      els.empty.style.display='flex';
    }

    // countdown global di header flash section
    if(flashActive()) renderCountdown(els.dealsCountdown, config.flashSale.end);
    injectOrgJsonLd();

    // wire modal close
    els.paymentModal.closeBtn.addEventListener('click', closePaymentModal);
    els.paymentModal.modal.addEventListener('click', (e)=>{ if(e.target===els.paymentModal.modal) closePaymentModal(); });
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
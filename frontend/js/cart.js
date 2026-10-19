// Cart, checkout, payments, order tracking, history, receipts.
// Uses helpers ($, esc, rupee, me, cfg) defined in customer.js, always at call time.
const Cart = (() => {
  const V = () => document.getElementById('view');
  let data = { restaurant: null, lines: [], subtotal: 0 };
  let chain = Promise.resolve(), timer = null, menuRid = null, menuData = [], refresher = null;

  const LABEL = { pending_payment: 'Awaiting payment', placed: 'Order placed', accepted: 'Restaurant accepted', preparing: 'Preparing food', ready: 'Food ready',
    partner_assigned: 'Delivery partner assigned', picked_up: 'Picked up', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
    cancelled: 'Cancelled', rejected: 'Rejected by restaurant' };
  const STEPS = ['placed', 'accepted', 'preparing', 'ready', 'partner_assigned', 'picked_up', 'out_for_delivery', 'delivered'];
  const count = () => data.lines.reduce((s, l) => s + l.qty, 0);
  const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  const desc = (l) => `${(l.options || []).length ? `<div class="sub">${esc(l.options.join(' · '))}</div>` : ''}${l.note ? `<div class="sub">“${esc(l.note)}”</div>` : ''}`;
  const toItems = () => data.lines.map((l) => ({ key: l.key, food_id: l.food_id, qty: l.qty, options: l.selection, note: l.note }));
  const body = (list) => list.map(({ food_id, qty, options, note }) => ({ food_id, qty, options, note }));

  function badge() {
    const n = count();
    document.querySelectorAll('.cart-count').forEach((e) => { e.textContent = n; e.classList.toggle('hidden', !n); });
  }
  async function load() { try { data = await App.api('/cart'); } catch { /* cart stays empty */ } badge(); }

  function put(list) { // changes run one after another so quick taps can't overwrite each other
    chain = chain.then(async () => {
      try { data = await App.api('/cart', { method: 'PUT', body: { items: list } }); } catch (e) { App.toast(e.message, 'error'); }
      badge(); paint();
    });
    return chain;
  }

  // Mixing restaurants isn't allowed: ask before starting a new cart.
  function guard(rid) {
    if (rid && data.restaurant && data.restaurant.id !== rid && data.lines.length)
      return confirm(`Your cart has dishes from ${data.restaurant.name}. Clear it and start a new cart here?`) ? [] : null;
    return toItems();
  }
  async function change(key, delta, rid) {
    let list = delta > 0 ? guard(rid) : toItems();
    if (!list) return;
    const hit = list.find((x) => x.key === key);
    if (hit) { hit.qty = Math.min(20, hit.qty + delta); if (hit.qty <= 0) list = list.filter((x) => x !== hit); }
    else if (delta > 0) list.push({ food_id: key, qty: 1, key });
    return put(body(list));
  }

  const stepper = (key, qty) => `<span class="stepper"><button data-act="dec" data-id="${esc(key)}" aria-label="Remove one">−</button><span>${qty}</span><button data-act="inc" data-id="${esc(key)}" aria-label="Add one">+</button></span>`;

  // ----- buttons on the menu -----
  function bindMenu(r, menu) { menuRid = r.is_open ? r.id : null; menuData = menu || []; paintMenu(r.is_open); }
  function paintMenu(open = menuRid !== null) {
    document.querySelectorAll('.addwrap[data-id]').forEach((w) => {
      const fid = w.dataset.id, q = data.lines.filter((l) => l.food_id === fid).reduce((s, l) => s + l.qty, 0);
      w.innerHTML = !open ? '<span class="closed-note">Restaurant closed</span>'
        : w.dataset.custom ? `<button class="addbtn" data-act="custom" data-id="${esc(fid)}">Add${q ? ` · ${q} in cart` : ''}</button> <span class="sub">Customisable</span>`
        : q ? stepper(fid, q) : `<button class="addbtn" data-act="inc" data-id="${esc(fid)}">Add</button>`;
    });
  }
  function paint() { paintMenu(); if (document.getElementById('cart-page')) showCart(); }

  // ----- dialogs -----
  function dlg() { let d = document.getElementById('cdlg'); if (!d) { d = document.createElement('dialog'); d.id = 'cdlg'; document.body.appendChild(d); } return d; }
  function askText(title, label, max = 500) {
    return new Promise((resolve) => {
      const d = dlg();
      d.innerHTML = `<form id="tf"><h3>${esc(title)}</h3><label class="stack">${esc(label)}<textarea class="field" id="tt" rows="4" maxlength="${max}" required></textarea></label><div class="row2"><button type="button" class="btn-line" id="tc">Cancel</button><button class="addbtn">Send</button></div></form>`;
      let done = false; const fin = (v) => { if (done) return; done = true; d.close(); resolve(v); };
      $('#tc').onclick = () => fin(null);
      $('#tf').onsubmit = (e) => { e.preventDefault(); fin($('#tt').value.trim()); };
      d.addEventListener('close', () => fin(null), { once: true });
      d.showModal();
    });
  }
  function openCustom(foodId) {
    const f = menuData.find((m) => m.id === foodId); if (!f) return;
    const d = dlg();
    const base = Number(f.price) * (1 - Number(f.discount_percent || 0) / 100);
    d.innerHTML = `<form id="cf"><h3>${esc(f.name)}</h3>${f.customizations.map((g, gi) => `<fieldset><legend>${esc(g.name)} <span class="sub">${g.type === 'one' ? 'Choose 1' : 'Choose any'}</span></legend>
      ${g.options.map((o, oi) => `<label class="opt2"><input type="${g.type === 'one' ? 'radio' : 'checkbox'}" name="g${gi}" value="${oi}" ${g.type === 'one' && oi === 0 ? 'checked' : ''}><span>${esc(o.label)}</span><span class="sub">${o.price ? '+' + rupee(o.price) : ''}</span></label>`).join('')}</fieldset>`).join('')}
      <label class="stack">Special instructions<input class="field" name="note" maxlength="100" placeholder="Optional, e.g. less spicy"></label>
      <div class="row2"><button type="button" class="btn-line" id="cc">Cancel</button><button class="addbtn" id="cadd">Add</button></div></form>`;
    const picked = () => f.customizations.flatMap((g, gi) => [...d.querySelectorAll(`[name=g${gi}]:checked`)].map((i) => ({ group: g.name, label: g.options[Number(i.value)].label, price: Number(g.options[Number(i.value)].price) })));
    const refresh = () => { $('#cadd').textContent = 'Add · ' + rupee(base + picked().reduce((s, x) => s + x.price, 0)); };
    d.addEventListener('change', refresh); refresh();
    $('#cc').onclick = () => d.close();
    $('#cf').onsubmit = (e) => {
      e.preventDefault();
      const list = guard(menuRid); if (!list) return;
      list.push({ food_id: f.id, qty: 1, options: picked().map(({ group, label }) => ({ group, label })), note: $('#cf').note.value.trim(), key: 'new' });
      put(body(list)); d.close();
    };
    d.showModal();
  }

  // ----- cart page -----
  function showCart() {
    const v = V();
    if (!data.lines.length) {
      v.innerHTML = `<div class="empty" id="cart-page"><i class="fa-solid fa-bag-shopping"></i><p>Your cart is empty. Pick a restaurant and add something tasty.</p><a class="addbtn" href="#/">Browse restaurants</a></div>`;
      return;
    }
    const stale = data.lines.some((l) => !l.available);
    v.innerHTML = `<div class="narrow" id="cart-page">
      <h1 style="margin:0">Your cart</h1>
      <div class="sub">From <a href="#/r/${esc(data.restaurant.id)}" style="color:var(--brand);font-weight:700">${esc(data.restaurant.name)}</a></div>
      ${data.lines.map((l) => `<div class="line"><div class="grow"><span class="dot ${l.is_veg ? '' : 'nv'}"></span> <strong>${esc(l.name)}</strong>${desc(l)}
        <div class="sub">${rupee(l.price)} each${l.available ? '' : ' · Unavailable'}</div></div>${stepper(l.key, l.qty)}<strong>${rupee(l.line_total)}</strong></div>`).join('')}
      <div class="bill panel" style="margin-top:16px"><div class="tot" style="border:0;margin:0;padding:0"><span>Subtotal</span><span>${rupee(data.subtotal)}</span></div>
        <div class="sub">Delivery, tax and coupons are added at checkout.</div></div>
      ${stale ? '<p class="sub">Some dishes are unavailable. Change any quantity to remove them.</p>' : ''}
      ${data.restaurant.is_open ? '<a class="primary" href="#/checkout">Go to checkout</a>' : '<p class="closed-note">This restaurant is closed right now.</p>'}
      <p><button class="link" data-act="clear">Clear cart</button></p></div>`;
  }

  // ----- checkout -----
  async function showCheckout() {
    if (!data.lines.length) { location.hash = '#/cart'; return; }
    const v = V();
    v.innerHTML = '<div class="narrow"><div class="sk"></div></div>';
    let addresses, quote, conf = {};
    const st = { sel: null, coupon: '', note: '', adding: false, pay: 'cod', pin: null };
    try { conf = await (await fetch('/api/config')).json(); } catch { /* online payments just stay hidden */ }
    try { ({ addresses } = await App.api('/addresses')); } catch { return v.innerHTML = '<div class="err"><i class="fa-solid fa-triangle-exclamation"></i><p>Couldn\'t load checkout. Check your connection and try again.</p></div>'; }
    st.sel = addresses[0]?.id || null; st.adding = !addresses.length;

    async function requote(code) {
      try { quote = await App.api('/orders/quote', { method: 'POST', body: code ? { coupon: code } : {} }); st.coupon = quote.coupon || ''; st.problem = ''; }
      catch (e) {
        App.toast(e.message, 'error');
        if (code) return requote('');
        quote = null; st.problem = e.message;
      }
    }
    await requote('');

    function draw() {
      const online = conf.paymentsEnabled;
      v.innerHTML = `<div class="narrow"><a class="back" href="#/cart"><i class="fa-solid fa-arrow-left"></i> Back to cart</a><h1 style="margin:0 0 14px">Checkout</h1>
        <div class="panel"><h3>Delivery address</h3>
          ${addresses.map((a) => `<label class="opt"><input type="radio" name="addr" value="${esc(a.id)}" ${a.id === st.sel ? 'checked' : ''}><span><strong>${esc(a.label)}</strong><br><span class="sub">${esc(a.full_address)}</span></span></label>`).join('')}
          ${st.adding ? `<div id="addr-form"><input class="field" id="a-label" placeholder="Label (Home, Work)" maxlength="30" style="margin-bottom:8px"><textarea class="field" id="a-text" rows="2" placeholder="House no, street, landmark, area" maxlength="300"></textarea>
            <div id="pickmap" class="pickmap"></div><p class="sub"><button type="button" class="link" id="a-loc"><i class="fa-solid fa-crosshairs"></i> Use my location</button> or tap the map to drop a pin, so your rider can find you.</p>
            <p><button class="addbtn" id="a-save">Save address</button> ${addresses.length ? '<button class="link" id="a-cancel">Cancel</button>' : ''}</p></div>`
            : '<button class="link" id="a-new">+ Add a new address</button>'}</div>
        <div class="panel"><h3>Delivery instructions</h3><textarea class="field" id="note" rows="2" maxlength="300" placeholder="Optional: gate code, landmark, call on arrival">${esc(st.note)}</textarea></div>
        <div class="panel"><h3>Coupon</h3><div class="row"><input class="field" id="coupon" placeholder="Enter code" value="${esc(st.coupon)}" maxlength="30"><button class="addbtn" id="apply">Apply</button></div>
          ${st.coupon ? `<p class="save" style="color:var(--ok);font-weight:600;margin:8px 0 0">${esc(st.coupon)} applied <button class="link" id="remove-c">Remove</button></p>` : ''}</div>
        <div class="panel bill"><h3>Bill</h3>${quote ? `
          <div><span>Items (${count()})</span><span>${rupee(quote.subtotal)}</span></div>
          <div><span>Delivery fee</span><span>${quote.delivery_fee ? rupee(quote.delivery_fee) : 'Free'}</span></div>
          <div><span>Taxes</span><span>${rupee(quote.taxes)}</span></div>
          ${quote.discount ? `<div class="save"><span>Discount</span><span>−${rupee(quote.discount)}</span></div>` : ''}
          <div class="tot"><span>To pay</span><span>${rupee(quote.total)}</span></div>` : `<p class="sub">${esc(st.problem || 'Couldn\'t calculate the bill.')}</p>`}</div>
        <div class="panel"><h3>Payment</h3>
          <label class="opt"><input type="radio" name="pay" value="cod" ${st.pay === 'cod' ? 'checked' : ''}><span><strong>Cash on delivery</strong><br><span class="sub">Pay your delivery partner when the food arrives.</span></span></label>
          <label class="opt" style="${online ? '' : 'opacity:.5'}"><input type="radio" name="pay" value="upi" ${st.pay === 'upi' ? 'checked' : ''} ${online ? '' : 'disabled'}><span><strong>UPI</strong><br><span class="sub">Google Pay, PhonePe, Paytm or any UPI app.</span></span></label>
          <label class="opt" style="${online ? '' : 'opacity:.5'}"><input type="radio" name="pay" value="razorpay" ${st.pay === 'razorpay' ? 'checked' : ''} ${online ? '' : 'disabled'}><span><strong>Card, netbanking or wallet</strong><br><span class="sub">${online ? 'Secure payment by Razorpay.' : 'Online payments aren’t set up yet.'}</span></span></label></div>
        <button class="primary" id="place" ${quote && st.sel ? '' : 'disabled'}>${st.pay === 'cod' ? 'Place order' : 'Pay & place order'}${quote ? ' · ' + rupee(quote.total) : ''}</button></div>`;
      const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
      document.querySelectorAll('input[name=addr]').forEach((r) => r.onchange = () => { st.sel = r.value; draw(); });
      document.getElementById('note')?.addEventListener('input', (e) => { st.note = e.target.value; });
      document.querySelectorAll('input[name=pay]').forEach((r) => r.onchange = () => { st.pay = r.value; draw(); });
      on('a-new', () => { st.adding = true; draw(); });
      on('a-cancel', () => { st.adding = false; draw(); });
      if (st.adding) initPicker(st);
      on('a-save', async () => {
        try {
          const { address } = await App.api('/addresses', { method: 'POST', body: { label: $('#a-label').value || 'Home', full_address: $('#a-text').value, latitude: st.pin?.[0] ?? null, longitude: st.pin?.[1] ?? null } });
          addresses.push(address); st.sel = address.id; st.adding = false; st.pin = null; draw();
        } catch (e) { App.toast(e.message, 'error'); }
      });
      on('apply', async () => { const c = $('#coupon').value.trim(); if (!c) return App.toast('Enter a coupon code', 'error'); await requote(c); draw(); if (quote?.coupon) App.toast('Coupon applied'); });
      on('remove-c', async () => { await requote(''); draw(); });
      on('place', async () => {
        if (!st.sel) return App.toast('Choose a delivery address', 'error');
        const b = $('#place'); b.disabled = true; b.textContent = 'Placing your order…';
        try {
          const r = await App.api('/orders', { method: 'POST', body: { address_id: st.sel, instructions: st.note || undefined, coupon: st.coupon || undefined, payment_method: st.pay } });
          await load();
          if (r.pay) { try { await startPayment(r.order_id, r.pay, st.pay); } catch (er) { App.toast(er.message, 'error'); } }
          location.hash = '#/order/' + r.order_id;
        } catch (e) { App.toast(e.message, 'error'); draw(); }
      });
    }
    draw();
  }

  // ----- online payment (Razorpay) -----
  const loadRzp = () => window.Razorpay ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = res; s.onerror = () => rej(new Error('Couldn’t open the payment window. Check your connection and retry from your order.')); document.head.appendChild(s);
  });
  async function startPayment(orderId, p, method) {
    await loadRzp();
    await new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: p.key, amount: p.amount, currency: p.currency, order_id: p.razorpay_order_id, name: p.name, description: 'Food order', theme: { color: '#FC8019' },
        prefill: { name: me.name, email: me.email, contact: me.phone, ...(method === 'upi' ? { method: 'upi' } : {}) },
        handler: async (resp) => { // the browser only forwards what Razorpay returned; the SERVER decides if it is real
          try { await App.api(`/orders/${orderId}/verify`, { method: 'POST', body: { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature } }); App.toast('Payment received'); }
          catch (e) { App.toast(e.message, 'error'); }
          resolve();
        },
        modal: { ondismiss: () => resolve() },
      });
      rzp.on('payment.failed', (r) => App.toast(r.error?.description || 'Payment failed. You can retry from your order.', 'error'));
      rzp.open();
    });
  }
  async function payExisting(id) {
    try { const r = await App.api(`/orders/${id}/pay`, { method: 'POST' }); if (!r.paid) await startPayment(id, r.pay, 'razorpay'); }
    catch (e) { App.toast(e.message, 'error'); }
    refresher && refresher();
  }
  async function cancelOrder(id) {
    try { await App.api(`/orders/${id}/cancel`, { method: 'POST' }); App.toast('Order cancelled'); } catch (e) { App.toast(e.message, 'error'); }
    refresher && refresher();
  }

  // ----- address picker + live delivery map -----
  async function initPicker(st) {
    const el = document.getElementById('pickmap'); if (!el) return;
    try {
      const L = await App.leaflet(); if (!document.getElementById('pickmap')) return;
      const m = L.map(el).setView(st.pin || [24.817, 93.937], st.pin ? 16 : 13); App.tiles(L).addTo(m);
      let mk = null;
      const put2 = (ll) => { st.pin = [ll[0], ll[1]]; mk ? mk.setLatLng(ll) : (mk = App.pin(L, ll, '#FC8019', 'Deliver here').addTo(m)); };
      if (st.pin) put2(st.pin);
      m.on('click', (e) => put2([e.latlng.lat, e.latlng.lng]));
      document.getElementById('a-loc').onclick = () => {
        if (!navigator.geolocation) return App.toast('This device can’t share location', 'error');
        navigator.geolocation.getCurrentPosition((p) => { const ll = [p.coords.latitude, p.coords.longitude]; put2(ll); m.setView(ll, 16); },
          () => App.toast('Location permission was denied. Tap the map instead.', 'error'), { enableHighAccuracy: true });
      };
    } catch { el.textContent = 'Map unavailable. You can still save the address.'; }
  }

  let tmap = null, tmarks = {}, ttimer = null;
  function stopTrack() { clearTimeout(ttimer); if (tmap) { tmap.remove(); tmap = null; } tmarks = {}; }
  async function trackMap(o) {
    stopTrack();
    if (!['partner_assigned', 'picked_up', 'out_for_delivery'].includes(o.order_status) || !document.getElementById('trackmap')) return;
    const tick = async () => {
      try {
        const t = await App.api(`/orders/${encodeURIComponent(o.id)}/tracking`);
        const el = document.getElementById('trackmap'), eta = document.getElementById('eta');
        if (!el || !t.active) return;
        if (!t.rider) { eta.textContent = 'Waiting for your delivery partner’s location…'; ttimer = setTimeout(tick, 10000); return; }
        const L = await App.leaflet(); el.classList.remove('hidden');
        const first = !tmap;
        if (first) { tmap = L.map(el); App.tiles(L).addTo(tmap); }
        const pts = [];
        [['rider', t.rider, '#FC8019', 'Your delivery partner'], ['rest', t.restaurant, '#6b6b6b', t.restaurant.name || 'Restaurant'], ['drop', t.drop, '#1a8f4c', 'You']].forEach(([k, s, c, label]) => {
          if (!s || s.lat == null) return;
          const ll = [s.lat, s.lng]; pts.push(ll);
          tmarks[k] ? tmarks[k].setLatLng(ll) : (tmarks[k] = App.pin(L, ll, c, label).addTo(tmap));
        });
        if (first && pts.length) tmap.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
        eta.textContent = t.eta_min ? `${t.heading_to === 'you' ? 'Arriving' : 'Reaching the restaurant'} in about ${t.eta_min} min · ${t.distance_km} km away (estimate)` : '';
        ttimer = setTimeout(tick, 10000);
      } catch { ttimer = setTimeout(tick, 20000); }
    };
    tick();
  }

  // ----- order tracking -----
  async function showOrder(id) {
    const v = V();
    async function fetchIt(first) {
      try {
        const { order: o, review } = await App.api('/orders/' + encodeURIComponent(id));
        if (!document.getElementById('order-page') && !first) return;
        const dead = ['cancelled', 'rejected'].includes(o.order_status), pend = o.order_status === 'pending_payment';
        const at = STEPS.indexOf(o.order_status);
        const reviewBlock = o.order_status !== 'delivered' ? '' : review
          ? `<div class="panel"><h3>Your rating</h3><div class="stars">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>${review.comment ? `<div class="sub">${esc(review.comment)}</div>` : ''}</div>`
          : `<div class="panel"><h3>How was your order?</h3><div class="starpick" role="radiogroup" aria-label="Rating">${[5, 4, 3, 2, 1].map((n) => `<label title="${n} star${n > 1 ? 's' : ''}"><input type="radio" name="star" value="${n}"><span>★</span></label>`).join('')}</div>
            <textarea class="field" id="rv-text" rows="2" maxlength="300" placeholder="Optional comment"></textarea><p><button class="addbtn" data-act="review" data-id="${esc(o.id)}">Submit rating</button></p></div>`;
        v.innerHTML = `<div class="narrow" id="order-page"><a class="back" href="#/orders"><i class="fa-solid fa-arrow-left"></i> My orders</a>
          <h1 style="margin:0">Order #${esc(o.id.slice(0, 8).toUpperCase())}</h1>
          <div class="sub">${esc(o.restaurants?.name || '')} · ${esc(when(o.created_at))}</div>
          <div class="panel" style="margin-top:14px"><h3>Status</h3>
            ${pend ? `<span class="pill">Awaiting payment</span><p class="sub">Your order goes to the restaurant as soon as payment succeeds.</p><button class="primary" data-act="pay" data-id="${esc(o.id)}">Pay ${rupee(o.total)}</button><p><button class="link" data-act="cancelorder" data-id="${esc(o.id)}">Cancel order</button></p>`
              : dead ? `<span class="pill bad">${esc(LABEL[o.order_status])}</span>${o.cancel_reason ? `<p class="sub">${esc(o.cancel_reason)}</p>` : ''}${o.payment_status === 'refunded' ? '<p class="sub">Your payment has been refunded.</p>' : ''}`
              : `<ul class="steps">${STEPS.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><i class="fa-solid ${i < at || (i === at && s === 'delivered') ? 'fa-circle-check' : i === at ? 'fa-circle-dot' : 'fa-circle'}"></i>${LABEL[s]}</li>`).join('')}</ul>
              <div id="trackmap" class="trackmap hidden"></div><div class="sub" id="eta"></div><div class="sub">Estimated delivery: 30–40 minutes from acceptance. This page updates automatically.</div>`}</div>
          ${!dead && !pend && o.order_status !== 'delivered' ? `<div class="panel"><h3>Delivery code</h3><div class="otp">${esc(o.delivery_otp)}</div><div class="sub">Tell this code to your delivery partner only when your food arrives.</div></div>` : ''}
          ${o.delivery_partners?.users ? `<div class="panel"><h3>Your delivery partner</h3><strong>${esc(o.delivery_partners.users.name)}</strong> <span class="sub">· ${esc(o.delivery_partners.vehicle_type)}</span>
            <div><a class="link" href="tel:${esc(String(o.delivery_partners.users.phone || '').replace(/[^\d+]/g, ''))}"><i class="fa-solid fa-phone"></i> Call ${esc(o.delivery_partners.users.phone || '')}</a></div></div>` : ''}
          ${reviewBlock}
          <div class="panel"><h3>Items</h3>${o.items.map((i) => `<div class="line" style="padding:8px 0"><div><span>${i.qty} × ${esc(i.name)}</span>${desc(i)}</div><span>${rupee(i.line_total)}</span></div>`).join('')}</div>
          <div class="panel"><h3>Delivering to</h3><strong>${esc(o.address.label)}</strong><div class="sub">${esc(o.address.full_address)}</div>${o.delivery_instructions ? `<div class="sub">Note: ${esc(o.delivery_instructions)}</div>` : ''}</div>
          <div class="panel bill"><h3>Bill</h3><div><span>Items</span><span>${rupee(o.subtotal)}</span></div><div><span>Delivery fee</span><span>${rupee(o.delivery_fee)}</span></div><div><span>Taxes</span><span>${rupee(o.taxes)}</span></div>
            ${Number(o.discount) ? `<div class="save"><span>Discount</span><span>−${rupee(o.discount)}</span></div>` : ''}
            <div class="tot"><span>Total</span><span>${rupee(o.total)}</span></div><div class="sub">${o.payment_method === 'cod' ? 'Cash on delivery' : 'Online payment'} · payment ${esc(o.payment_status)}</div></div>
          ${pend ? '' : `<p class="sub">Need help? <button class="link" data-act="complain" data-id="${esc(o.id)}">Report a problem</button> · <a class="link" href="#/receipt/${esc(o.id)}">View receipt</a></p>`}</div>`;
        trackMap(o);
        if (!dead && o.order_status !== 'delivered') timer = setTimeout(() => fetchIt(false), 30000); // safety net; live updates arrive instantly
      } catch (e) {
        if (first) v.innerHTML = `<div class="empty"><i class="fa-solid fa-receipt"></i><p>We couldn't find that order. <a href="#/orders" style="color:var(--brand);font-weight:700">See my orders</a></p></div>`;
        else if (document.getElementById('order-page')) timer = setTimeout(() => fetchIt(false), 15000);
      }
    }
    v.innerHTML = '<div class="narrow"><div class="sk"></div></div>';
    refresher = () => { clearTimeout(timer); fetchIt(false); };
    fetchIt(true);
  }

  async function submitReview(id) {
    const star = document.querySelector('input[name=star]:checked');
    if (!star) return App.toast('Tap a star to rate', 'error');
    try { await App.api(`/orders/${id}/review`, { method: 'POST', body: { rating: Number(star.value), comment: $('#rv-text').value.trim() || undefined } }); App.toast('Thanks for your feedback!'); }
    catch (e) { App.toast(e.message, 'error'); }
    refresher && refresher();
  }
  async function complain(id) {
    const msg = await askText('Report a problem', 'Tell us what went wrong', 500);
    if (!msg) return;
    try { await App.api(`/orders/${id}/complaint`, { method: 'POST', body: { message: msg } }); App.toast('Thanks. We’ve received your message and will get back to you.'); }
    catch (e) { App.toast(e.message, 'error'); }
  }

  // ----- receipt (print or save as PDF) -----
  async function showReceipt(id) {
    const v = V();
    v.innerHTML = '<div class="narrow"><div class="sk"></div></div>';
    try {
      const { order: o } = await App.api('/orders/' + encodeURIComponent(id));
      v.innerHTML = `<div class="narrow receipt"><div class="row noprint" style="margin-bottom:12px"><a class="back" href="#/order/${esc(o.id)}"><i class="fa-solid fa-arrow-left"></i> Back</a><button class="addbtn" id="print">Print / Save as PDF</button></div>
        <h1 style="margin:0">${esc(cfg.name || 'Zestly')}</h1><div class="sub">Tax invoice / receipt</div>
        <p><strong>Order #${esc(o.id.slice(0, 8).toUpperCase())}</strong><br><span class="sub">${esc(when(o.created_at))}</span><br><span class="sub">${esc(o.restaurants?.name || '')}</span></p>
        <p class="sub">Delivered to: ${esc(o.address.label)}, ${esc(o.address.full_address)}</p>
        ${o.items.map((i) => `<div class="line"><div><span>${i.qty} × ${esc(i.name)}</span>${desc(i)}</div><span>${rupee(i.line_total)}</span></div>`).join('')}
        <div class="bill" style="margin-top:12px"><div><span>Items</span><span>${rupee(o.subtotal)}</span></div><div><span>Delivery fee</span><span>${rupee(o.delivery_fee)}</span></div><div><span>Taxes</span><span>${rupee(o.taxes)}</span></div>
          ${Number(o.discount) ? `<div class="save"><span>Discount</span><span>−${rupee(o.discount)}</span></div>` : ''}<div class="tot"><span>Total</span><span>${rupee(o.total)}</span></div></div>
        <p class="sub">Paid by: ${o.payment_method === 'cod' ? 'Cash on delivery' : 'Online payment'} (${esc(o.payment_status)})</p>
        ${cfg.support_phone ? `<p class="sub">Support: ${esc(cfg.support_phone)}</p>` : ''}</div>`;
      $('#print').onclick = () => (window.AndroidBridge ? window.AndroidBridge.print() : window.print());
    } catch { v.innerHTML = `<div class="empty"><i class="fa-solid fa-receipt"></i><p>We couldn't load this receipt.</p></div>`; }
  }

  // ----- order history -----
  async function showOrders(quiet) {
    const v = V();
    refresher = () => showOrders(true);
    if (!quiet) v.innerHTML = '<div class="narrow"><div class="sk"></div></div>';
    try {
      const { orders } = await App.api('/orders');
      v.innerHTML = `<div class="narrow"><h1 style="margin:0 0 14px">My orders</h1>${orders.length ? orders.map((o) => `
        <div class="ordercard"><a href="#/order/${esc(o.id)}"><div class="top2"><strong>${esc(o.restaurants?.name || 'Restaurant')}</strong>
          <span class="pill ${o.order_status === 'delivered' ? 'good' : ['cancelled', 'rejected'].includes(o.order_status) ? 'bad' : ''}">${esc(LABEL[o.order_status])}</span></div>
          <div class="sub">${esc(o.items.map((i) => `${i.qty} × ${i.name}`).join(', '))}</div>
          <div class="sub">${esc(when(o.created_at))} · <strong>${rupee(o.total)}</strong></div></a>
          <p style="margin:10px 0 0"><button class="link" data-act="reorder" data-id="${esc(o.id)}">Reorder</button></p></div>`).join('')
        : '<div class="empty"><i class="fa-solid fa-receipt"></i><p>No orders yet. Your first one will show up here.</p><a class="addbtn" href="#/">Browse restaurants</a></div>'}</div>`;
    } catch { v.innerHTML = '<div class="err"><i class="fa-solid fa-triangle-exclamation"></i><p>Couldn\'t load your orders. Check your connection and try again.</p></div>'; }
  }

  async function reorder(id) {
    if (data.lines.length && !confirm('Replace the dishes in your cart with this order?')) return;
    try {
      const { order } = await App.api('/orders/' + encodeURIComponent(id));
      await put(order.items.map((i) => ({ food_id: i.food_id, qty: i.qty, options: i.selection || [], note: i.note || '' })));
      if (data.lines.length) location.hash = '#/cart'; else App.toast('Those dishes are no longer available', 'error');
    } catch (e) { App.toast(e.message, 'error'); }
  }

  // one click handler for every cart/order button
  document.getElementById('view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { act, id } = b.dataset;
    if (act === 'inc') change(id, 1, menuRid);
    else if (act === 'dec') change(id, -1);
    else if (act === 'custom') openCustom(id);
    else if (act === 'clear') { if (confirm('Remove everything from your cart?')) put([]); }
    else if (act === 'reorder') reorder(id);
    else if (act === 'pay') payExisting(id);
    else if (act === 'cancelorder') { if (confirm('Cancel this order?')) cancelOrder(id); }
    else if (act === 'review') submitReview(id);
    else if (act === 'complain') complain(id);
  });

  return { load, bindMenu, stop: () => { clearTimeout(timer); refresher = null; stopTrack(); }, refresh: () => refresher && refresher(), reload: async () => { await load(); paint(); },
    show: { cart: showCart, checkout: showCheckout, orders: showOrders, order: showOrder, receipt: showReceipt } };
})();

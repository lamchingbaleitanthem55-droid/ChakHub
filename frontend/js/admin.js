const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const A = (path, opt) => App.api('/admin' + path, opt);
const V = $('#view');
const ST = { pending_payment: 'Awaiting payment', placed: 'Placed', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready', partner_assigned: 'Partner assigned', picked_up: 'Picked up',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled', rejected: 'Rejected' };
const pill = (s) => `<span class="pill ${s === 'delivered' || s === 'active' || s === 'approved' ? 'good' : ['cancelled', 'rejected', 'suspended', 'inactive'].includes(s) ? 'bad' : ''}">${esc(ST[s] || s)}</span>`;
const shortId = (id) => '#' + id.slice(0, 8).toUpperCase();
const loading = () => { V.innerHTML = '<div class="cards"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>'; };
const empty = (t) => `<div class="empty"><i class="fa-regular fa-folder-open fa-2x"></i><p>${esc(t)}</p></div>`;
const failed = (fn) => { V.innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation fa-2x"></i><p>Couldn\'t load this. Check your connection and try again.</p><button class="btn" id="retry">Try again</button></div>'; $('#retry').onclick = fn; };
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { App.toast(e.message, 'error'); } };

// Customisation options are typed one group per line, e.g.  Size [one] : Regular, Large +60
const parseCust = (txt) => txt.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const m = l.match(/^([^:\[]+?)\s*\[(one|many)\]\s*:\s*(.+)$/i);
  if (!m) throw new Error(`Customisation lines look like: Size [one] : Regular, Large +60   (problem: "${l}")`);
  return { name: m[1].trim(), type: m[2].toLowerCase(), options: m[3].split(',').map((o) => { const x = o.trim().match(/^(.*?)(?:\s*\+\s*(\d+(?:\.\d+)?))?$/); return { label: x[1].trim(), price: Number(x[2] || 0) }; }).filter((o) => o.label) };
});
const fmtCust = (arr) => (Array.isArray(arr) ? arr : []).map((g) => `${g.name} [${g.type}] : ${g.options.map((o) => o.label + (o.price ? ` +${o.price}` : '')).join(', ')}`).join('\n');

// ---------- generic form dialog ----------
function formModal(title, fields, vals, onSave) {
  const d = $('#dlg');
  const inp = (f) => {
    const v = vals[f.name] ?? f.def ?? '';
    const a = `name="${f.name}" id="f-${f.name}" ${f.required ? 'required' : ''}`;
    if (f.type === 'checkbox') return `<label class="chk"><input type="checkbox" ${a} ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    const ctl = f.type === 'textarea' ? `<textarea ${a} rows="3">${esc(v)}</textarea>`
      : f.type === 'cust' ? `<textarea ${a} rows="4" placeholder="Size [one] : Regular, Large +60&#10;Extras [many] : Extra cheese +30, Olives +20">${esc(fmtCust(v))}</textarea><span class="sub">[one] = customer must pick one, [many] = pick any. +number adds to the price.</span>`
      : f.type === 'image' ? `<span style="display:flex;gap:6px"><input ${a} type="text" value="${esc(v)}" placeholder="https://… or upload a file"><input type="file" accept="image/jpeg,image/png,image/webp" data-up="${f.name}" style="width:auto"></span>`
      : f.type === 'select' ? `<select ${a}>${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
      : `<input ${a} type="${f.type === 'tags' ? 'text' : f.type || 'text'}" ${f.type === 'number' ? 'step="any"' : ''} value="${esc(f.type === 'tags' ? [].concat(v).join(', ') : v)}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`;
    return `<label>${esc(f.label)}${ctl}</label>`;
  };
  d.innerHTML = `<form id="f"><h3>${esc(title)}</h3>${fields.map(inp).join('')}<div class="actions"><button type="button" class="btn ghost" id="cx">Cancel</button><button class="btn">Save</button></div></form>`;
  $('#cx').onclick = () => d.close();
  d.querySelectorAll('[data-up]').forEach((inp) => { inp.onchange = async () => {
    if (!inp.files[0]) return;
    try { const r = await App.upload('/admin/upload', inp.files[0]); $('#f-' + inp.dataset.up).value = r.url; App.toast('Image uploaded'); } catch (er) { App.toast(er.message, 'error'); }
  }; });
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    try { fields.forEach((f) => {
      const el = $('#f-' + f.name), raw = f.type === 'checkbox' ? el.checked : el.value.trim();
      out[f.name] = f.type === 'number' ? (raw === '' ? null : Number(raw)) : f.type === 'tags' ? raw.split(',').map((x) => x.trim()).filter(Boolean) : f.type === 'cust' ? parseCust(raw) : raw;
    }); } catch (er) { return App.toast(er.message, 'error'); }
    const b = $('#f .btn:not(.ghost)'); b.disabled = true;
    try { await onSave(out); d.close(); } catch (er) { App.toast(er.message, 'error'); b.disabled = false; }
  };
  d.showModal();
}
const confirmDo = (msg, fn) => { if (confirm(msg)) guard(fn)(); };

// ---------- Dashboard ----------
async function dashboard(quiet) {
  if (!quiet) loading();
  try {
    const s = await A('/stats');
    const max = Math.max(1, ...s.chart.map((c) => c.revenue));
    const bars = s.chart.map((c, i) => { const h = Math.round((c.revenue / max) * 110); return `<g><rect x="${20 + i * 76}" y="${130 - h}" width="48" height="${h}" rx="6" fill="#FC8019"/><text x="${44 + i * 76}" y="148" text-anchor="middle" font-size="11" fill="currentColor">${esc(c.day.slice(5))}</text><text x="${44 + i * 76}" y="${124 - h}" text-anchor="middle" font-size="10" fill="currentColor">${c.revenue ? Math.round(c.revenue) : ''}</text></g>`; }).join('');
    const card = (l, v) => `<div class="stat"><span>${l}</span><b>${v}</b></div>`;
    V.innerHTML = `<h1>Dashboard</h1><div class="cards">
      ${card('Customers', s.customers)}${card('Restaurants', s.restaurants)}${card('Total orders', s.counts.total)}${card('Pending', s.counts.pending)}
      ${card('Preparing', s.counts.preparing)}${card('Out for delivery', s.counts.out)}${card('Completed', s.counts.completed)}${card('Cancelled', s.counts.cancelled)}
      ${card('Total revenue', rupee(s.revenue.total))}${card('Today’s revenue', rupee(s.revenue.today))}${card('Platform commission', rupee(s.revenue.commission))}
      ${card('Delivery earnings', rupee(s.revenue.delivery_earnings))}${card('Riders online', s.partners.online + ' / ' + s.partners.total)}</div>
      <div class="two"><div class="box"><h3>Revenue, last 7 days</h3><svg class="chart" viewBox="0 0 550 155" role="img" aria-label="Revenue chart">${bars}</svg></div>
      <div class="box"><h3>Restaurant performance</h3>${s.performance.length ? `<div class="tw"><table><tr><th>Restaurant</th><th>Delivered</th><th>Revenue</th></tr>${s.performance.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.orders}</td><td>${rupee(p.revenue)}</td></tr>`).join('')}</table></div>` : empty('No restaurants yet')}</div></div>
      <div class="box"><h3>Recent orders</h3>${s.recent.length ? `<div class="tw"><table><tr><th>Order</th><th>Customer</th><th>Restaurant</th><th>Total</th><th>Status</th><th>Time</th></tr>${s.recent.map((o) => `<tr><td>${shortId(o.id)}</td><td>${esc(o.users?.name)}</td><td>${esc(o.restaurants?.name)}</td><td>${rupee(o.total)}</td><td>${pill(o.order_status)}</td><td>${when(o.created_at)}</td></tr>`).join('')}</table></div>` : empty('No orders yet')}</div>`;
  } catch { if (!quiet) failed(dashboard); }
}

// ---------- Restaurants ----------
const RF = [{ name: 'name', label: 'Name', required: true }, { name: 'description', label: 'Description', type: 'textarea' }, { name: 'address', label: 'Address', required: true },
  { name: 'latitude', label: 'Latitude', type: 'number', ph: '24.8074' }, { name: 'longitude', label: 'Longitude', type: 'number', ph: '93.9384' },
  { name: 'phone', label: 'Contact number' }, { name: 'image', label: 'Image', type: 'image' }, { name: 'cuisine', label: 'Cuisines (comma separated)', type: 'tags', required: true },
  { name: 'opening_time', label: 'Opens', type: 'time', required: true, def: '10:00' }, { name: 'closing_time', label: 'Closes', type: 'time', required: true, def: '22:00' },
  { name: 'delivery_fee', label: 'Delivery fee (₹)', type: 'number', required: true, def: 30 },
  { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['inactive', 'Inactive']] }];
let rests = [];
async function restaurants() {
  loading();
  try {
    ({ restaurants: rests } = await A('/restaurants'));
    V.innerHTML = `<div class="bar"><h1>Restaurants</h1><button class="btn" id="add"><i class="fa-solid fa-plus"></i> Add restaurant</button></div>
      <div class="box tw">${rests.length ? `<table><tr><th>Name</th><th>Cuisine</th><th>Hours</th><th>Fee</th><th>Status</th><th></th></tr>${rests.map((r) => `<tr><td><b>${esc(r.name)}</b><div class="sub">${esc(r.address)}</div></td><td>${esc(r.cuisine.join(', '))}</td><td>${esc(r.opening_time?.slice(0, 5))}–${esc(r.closing_time?.slice(0, 5))}</td><td>${rupee(r.delivery_fee)}</td><td>${pill(r.status)}</td>
        <td class="act"><button class="btn sm ghost" data-a="edit" data-id="${r.id}">Edit</button><button class="btn sm ghost" data-a="toggle" data-id="${r.id}">${r.status === 'active' ? 'Deactivate' : 'Activate'}</button><button class="btn sm bad" data-a="del" data-id="${r.id}">Delete</button></td></tr>`).join('')}</table>` : empty('No restaurants yet. Add your first one.')}</div>`;
    $('#add').onclick = () => formModal('Add restaurant', RF, {}, async (b) => { await A('/restaurants', { method: 'POST', body: b }); App.toast('Restaurant added'); restaurants(); });
  } catch { failed(restaurants); }
}

// ---------- Foods ----------
let foodRest = '';
const FF = (rs) => [{ name: 'restaurant_id', label: 'Restaurant', type: 'select', options: rs.map((r) => [r.id, r.name]) }, { name: 'name', label: 'Dish name', required: true },
  { name: 'description', label: 'Description', type: 'textarea' }, { name: 'price', label: 'Price (₹)', type: 'number', required: true }, { name: 'category', label: 'Category (e.g. Pizza, Biryani)', required: true },
  { name: 'image', label: 'Image', type: 'image' }, { name: 'discount_percent', label: 'Discount %', type: 'number', def: 0 },
  { name: 'customizations', label: 'Customisation options (optional)', type: 'cust' },
  { name: 'is_veg', label: 'Vegetarian', type: 'checkbox', def: true }, { name: 'availability', label: 'Available to order', type: 'checkbox', def: true }];
let foods = [];
async function foodsView() {
  loading();
  try {
    if (!rests.length) ({ restaurants: rests } = await A('/restaurants'));
    if (!rests.length) { V.innerHTML = `<h1>Foods</h1>${empty('Add a restaurant first, then you can add dishes to it.')}`; return; }
    if (!rests.some((r) => r.id === foodRest)) foodRest = rests[0].id;
    ({ foods } = await A('/foods?restaurant_id=' + foodRest));
    V.innerHTML = `<div class="bar"><h1>Foods</h1><select id="rsel">${rests.map((r) => `<option value="${r.id}" ${r.id === foodRest ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select><button class="btn" id="add"><i class="fa-solid fa-plus"></i> Add dish</button></div>
      <div class="box tw">${foods.length ? `<table><tr><th>Dish</th><th>Category</th><th>Price</th><th>Discount</th><th>Type</th><th>Available</th><th></th></tr>${foods.map((f) => `<tr><td><b>${esc(f.name)}</b><div class="sub">${esc(f.description)}</div></td><td>${esc(f.category)}</td><td>${rupee(f.price)}</td><td>${Number(f.discount_percent) ? f.discount_percent + '%' : '–'}</td><td>${f.is_veg ? 'Veg' : 'Non-veg'}</td>
        <td><button class="btn sm ${f.availability ? 'good' : 'ghost'}" data-a="avail" data-id="${f.id}">${f.availability ? 'In stock' : 'Unavailable'}</button></td>
        <td class="act"><button class="btn sm ghost" data-a="edit" data-id="${f.id}">Edit</button><button class="btn sm bad" data-a="del" data-id="${f.id}">Delete</button></td></tr>`).join('')}</table>` : empty('No dishes for this restaurant yet.')}</div>`;
    $('#rsel').onchange = (e) => { foodRest = e.target.value; foodsView(); };
    $('#add').onclick = () => formModal('Add dish', FF(rests), { restaurant_id: foodRest }, async (b) => { await A('/foods', { method: 'POST', body: b }); App.toast('Dish added'); foodsView(); });
  } catch { failed(foodsView); }
}

// ---------- Orders ----------
let ofilter = 'all', lastPlaced = null;
const orderActions = (o) => {
  const b = (a, t, c = '') => `<button class="btn sm ${c}" data-a="${a}" data-id="${o.id}">${t}</button>`, s = o.order_status;
  return (s === 'pending_payment' && o.payment_method === 'upi' && o.payment_status !== 'paid' ? b('verifyupi', 'Verify UPI', 'good') : '') +
    (s === 'placed' ? b('accepted', 'Accept', 'good') + b('rejected', 'Reject', 'bad') : s === 'accepted' ? b('preparing', 'Start preparing')
    : s === 'preparing' ? b('ready', 'Mark ready') : '') + b('detail', 'Details', 'ghost')
    + (['placed', 'accepted', 'preparing', 'ready', 'partner_assigned'].includes(s) && s !== 'placed' ? b('cancelled', 'Cancel', 'bad') : '')
    + (['cancelled', 'rejected'].includes(s) && o.payment_status === 'paid' && o.payment_method !== 'cod' ? b('refund', 'Refund', 'good') : '');
};
let orderList = [];
async function ordersView(quiet) {
  if (!quiet) loading();
  try {
    ({ orders: orderList } = await A('/orders?status=' + ofilter));
    V.innerHTML = `<div class="bar"><h1>Orders</h1><select id="osel"><option value="all">All orders</option>${Object.entries(ST).map(([k, l]) => `<option value="${k}" ${k === ofilter ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="box tw">${orderList.length ? `<table><tr><th>Order</th><th>Customer</th><th>Restaurant</th><th>Items</th><th>Total</th><th>Payment</th><th>Rider</th><th>Status</th><th></th></tr>${orderList.map((o) => `<tr><td>${shortId(o.id)}<div class="sub">${when(o.created_at)}</div></td><td>${esc(o.users?.name)}<div class="sub">${esc(o.users?.phone)}</div></td><td>${esc(o.restaurants?.name)}</td>
        <td>${esc(o.items.map((i) => i.qty + '× ' + i.name).join(', '))}</td><td>${rupee(o.total)}</td><td>${esc(o.payment_method.toUpperCase())}<div class="sub">${esc(o.payment_status)}</div></td>
        <td>${esc(o.delivery_partners?.users?.name || '–')}</td><td>${pill(o.order_status)}</td><td class="act">${orderActions(o)}</td></tr>`).join('')}</table>` : empty('No orders to show.')}</div>`;
    $('#osel').onchange = (e) => { ofilter = e.target.value; ordersView(); };
  } catch { if (!quiet) failed(ordersView); }
}
const statusToast = (r) => App.toast(r?.refund ? 'Order updated. Refund: ' + r.refund : 'Order updated', String(r?.refund).startsWith('failed') ? 'error' : 'ok');
const setStatus = (id, status, reason) => A(`/orders/${id}/status`, { method: 'PATCH', body: { status, reason } });
function orderDetail(o) {
  const d = $('#dlg');
  d.innerHTML = `<h3>Order ${shortId(o.id)}</h3><p>${pill(o.order_status)} <span class="sub">${when(o.created_at)}</span></p>
    <p><b>${esc(o.users?.name)}</b> · ${esc(o.users?.phone)}<br><span class="sub">${esc(o.address.label)}: ${esc(o.address.full_address)}</span></p>
    ${o.delivery_instructions ? `<p class="sub">Customer note: ${esc(o.delivery_instructions)}</p>` : ''}${o.cancel_reason ? `<p class="sub">Reason: ${esc(o.cancel_reason)}</p>` : ''}
    <table>${o.items.map((i) => `<tr><td>${i.qty} × ${esc(i.name)}${(i.options || []).length ? `<div class="sub">${esc(i.options.join(' · '))}</div>` : ''}${i.note ? `<div class="sub">“${esc(i.note)}”</div>` : ''}</td><td>${rupee(i.line_total)}</td></tr>`).join('')}
    <tr><td>Delivery</td><td>${rupee(o.delivery_fee)}</td></tr><tr><td>Taxes</td><td>${rupee(o.taxes)}</td></tr>${Number(o.discount) ? `<tr><td>Discount</td><td>−${rupee(o.discount)}</td></tr>` : ''}
    <tr><td><b>Total</b></td><td><b>${rupee(o.total)}</b></td></tr></table>
    <p class="sub">Platform commission: ${rupee(o.platform_commission)}</p><div class="actions"><button class="btn ghost" id="cx">Close</button></div>`;
  $('#cx').onclick = () => d.close(); d.showModal();
}

// ---------- Customers ----------
let cq = '';
async function customers() {
  loading();
  try {
    const { customers: cs } = await A('/customers?q=' + encodeURIComponent(cq));
    V.innerHTML = `<div class="bar"><h1>Customers</h1><input id="cs" type="search" placeholder="Search name, email or phone" value="${esc(cq)}"></div>
      <div class="box tw">${cs.length ? `<table><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th>Status</th><th></th></tr>${cs.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${when(c.created_at)}</td><td>${pill(c.status)}</td>
        <td class="act"><button class="btn sm ghost" data-a="corders" data-id="${c.id}">Orders</button><button class="btn sm ${c.status === 'active' ? 'bad' : 'good'}" data-a="cstatus" data-id="${c.id}" data-s="${c.status === 'active' ? 'suspended' : 'active'}">${c.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td></tr>`).join('')}</table>` : empty('No customers found.')}</div>`;
    let t; $('#cs').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { cq = e.target.value; customers(); }, 400); };
    const i = $('#cs'); i.focus(); i.setSelectionRange(cq.length, cq.length);
  } catch { failed(customers); }
}

// ---------- Delivery partners ----------
let pmap = null, pmarkers = {}, cachedAvail = {};
async function drawPartnerMap(ps) {
  const el = $('#pmap'); if (!el) return;
  try {
    const L = await App.leaflet();
    if (pmap) pmap.remove();
    pmarkers = {}; pmap = L.map(el).setView([24.817, 93.937], 12); App.tiles(L).addTo(pmap);
    const pts = [];
    ps.filter((p) => p.current_latitude != null).forEach((p) => { const ll = [p.current_latitude, p.current_longitude]; pts.push(ll); pmarkers[p.id] = App.pin(L, ll, '#FC8019', p.users?.name || 'Rider').addTo(pmap); });
    if (pts.length) pmap.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
    $('#pmapnote').textContent = pts.length ? '' : 'Riders appear here while they are on an active delivery.';
  } catch { const n = $('#pmapnote'); if (n) n.textContent = 'Map unavailable right now.'; }
}
async function partners(quiet) {
  if (!quiet) loading();
  try {
    const { partners: ps } = await A('/partners');
    const b = (id, s, t, c = '') => `<button class="btn sm ${c}" data-a="pstatus" data-id="${id}" data-s="${s}">${t}</button>`;
    ps.forEach((p) => { cachedAvail[p.id] = p.availability; });
    V.innerHTML = `<h1>Delivery partners</h1><div class="box" style="margin-bottom:16px"><h3>Live map</h3><div id="pmap" style="height:300px;border-radius:12px"></div><div class="sub" id="pmapnote"></div></div><div class="box tw">${ps.length ? `<table><tr><th>Name</th><th>Contact</th><th>Vehicle</th><th>Approval</th><th>Availability</th><th></th></tr>${ps.map((p) => `<tr><td>${esc(p.users?.name)}</td><td>${esc(p.users?.phone)}<div class="sub">${esc(p.users?.email)}</div></td><td>${esc(p.vehicle_type)}</td><td>${pill(p.approval_status)}</td>
      <td><span class="pill ${p.availability === 'online' ? 'good' : 'grey'}">${esc(p.availability)}</span></td><td class="act">${p.approval_status === 'approved' ? b(p.id, 'suspended', 'Suspend', 'bad') : b(p.id, 'approved', 'Approve', 'good')}${p.approval_status === 'pending' ? b(p.id, 'rejected', 'Reject', 'bad') : ''}</td></tr>`).join('')}</table>` : empty('No delivery partners have signed up yet.')}</div>`;
    drawPartnerMap(ps);
  } catch { if (!quiet) failed(partners); }
}

// ---------- Complaints ----------
async function complaints() {
  loading();
  try {
    const { complaints: cs } = await A('/complaints');
    V.innerHTML = `<h1>Customer complaints</h1><div class="box tw">${cs.length ? `<table><tr><th>Customer</th><th>Order</th><th>Message</th><th>Received</th><th>Status</th><th></th></tr>${cs.map((c) => `<tr><td>${esc(c.users?.name)}<div class="sub">${esc(c.users?.phone)}</div></td><td>${c.order_id ? shortId(c.order_id) : '–'}</td><td style="max-width:320px">${esc(c.message)}</td><td>${when(c.created_at)}</td><td>${pill(c.status === 'open' ? 'pending_payment' : 'delivered').replace(/Awaiting payment|Delivered/, c.status === 'open' ? 'Open' : 'Resolved')}</td>
      <td>${c.status === 'open' ? `<button class="btn sm good" data-a="cresolve" data-id="${c.id}">Mark resolved</button>` : ''}</td></tr>`).join('')}</table>` : empty('No complaints. Nice.')}</div>`;
  } catch { failed(complaints); }
}

// ---------- Earnings ----------
async function earnings() {
  loading();
  try {
    const f = await A('/finance');
    const card = (l, v) => `<div class="stat"><span>${l}</span><b>${rupee(v)}</b></div>`;
    V.innerHTML = `<h1>Earnings</h1><div class="cards">${card('Total sales', f.total_sales)}${card('Platform earnings', f.platform_earnings)}${card('Restaurant payouts', f.restaurant_payouts)}${card('Delivery payouts', f.delivery_payouts)}${card('Refunds', f.refunds)}</div>
      <div class="box"><h3>Payment history</h3>${f.payments.length ? `<div class="tw"><table><tr><th>Order</th><th>Amount</th><th>Method</th><th>Status</th><th>Time</th></tr>${f.payments.map((p) => `<tr><td>${shortId(p.order_id)}</td><td>${rupee(p.amount)}</td><td>${esc(p.payment_method.toUpperCase())}</td><td>${esc(p.payment_status)}</td><td>${when(p.created_at)}</td></tr>`).join('')}</table></div>` : empty('No payments yet.')}</div>`;
  } catch { failed(earnings); }
}

// ---------- Coupons ----------
const CF = [{ name: 'code', label: 'Code (letters and numbers)', required: true }, { name: 'discount_type', label: 'Type', type: 'select', options: [['percent', 'Percentage off'], ['fixed', 'Fixed amount off']] },
  { name: 'discount_value', label: 'Discount value', type: 'number', required: true }, { name: 'minimum_order', label: 'Minimum order (₹)', type: 'number', def: 0 },
  { name: 'usage_limit', label: 'Max uses (blank = unlimited)', type: 'number' }, { name: 'expiry_date', label: 'Expires on', type: 'date' }];
async function coupons() {
  loading();
  try {
    const { coupons: cs } = await A('/coupons');
    V.innerHTML = `<div class="bar"><h1>Coupons</h1><button class="btn" id="add"><i class="fa-solid fa-plus"></i> New coupon</button></div><div class="box tw">${cs.length ? `<table><tr><th>Code</th><th>Discount</th><th>Min order</th><th>Used</th><th>Expires</th><th>Status</th><th></th></tr>${cs.map((c) => `<tr><td><b>${esc(c.code)}</b></td><td>${c.discount_type === 'percent' ? c.discount_value + '%' : rupee(c.discount_value)}</td><td>${rupee(c.minimum_order)}</td><td>${c.used_count}${c.usage_limit ? ' / ' + c.usage_limit : ''}</td><td>${c.expiry_date ? when(c.expiry_date) : 'Never'}</td><td>${pill(c.active ? 'active' : 'inactive')}</td>
      <td><button class="btn sm ghost" data-a="ctoggle" data-id="${c.id}" data-s="${c.active ? 0 : 1}">${c.active ? 'Disable' : 'Enable'}</button></td></tr>`).join('')}</table>` : empty('No coupons yet.')}</div>`;
    $('#add').onclick = () => formModal('New coupon', CF, {}, async (b) => { if (b.expiry_date) b.expiry_date = new Date(b.expiry_date + 'T23:59:59+05:30').toISOString(); else b.expiry_date = null; await A('/coupons', { method: 'POST', body: b }); App.toast('Coupon created'); coupons(); });
  } catch { failed(coupons); }
}

// ---------- Settings ----------
const SF = [{ name: 'name', label: 'Application name', required: true }, { name: 'currency', label: 'Currency', required: true, def: 'INR' }, { name: 'tax_percent', label: 'Tax (%)', type: 'number', required: true },
  { name: 'min_order', label: 'Minimum order amount (₹)', type: 'number', required: true }, { name: 'platform_commission_percent', label: 'Platform commission (%)', type: 'number', required: true },
  { name: 'base_delivery_fee', label: 'Default delivery fee (₹)', type: 'number', required: true }, { name: 'support_phone', label: 'Support phone' }, { name: 'logo_url', label: 'Logo', type: 'image' },
  { name: 'service_available', label: 'Accepting orders (turn off to pause the service)', type: 'checkbox' }];
async function settings() {
  loading();
  try {
    const { settings: s } = await A('/settings');
    V.innerHTML = `<h1>Settings</h1><div class="box" style="max-width:520px"><button class="btn" id="edit">Edit settings</button><table style="margin-top:14px">${SF.map((f) => `<tr><td>${esc(f.label)}</td><td><b>${esc(f.type === 'checkbox' ? (s[f.name] ? 'Yes' : 'No') : s[f.name])}</b></td></tr>`).join('')}</table></div>`;
    $('#edit').onclick = () => formModal('Edit settings', SF, s, async (b) => { await A('/settings', { method: 'PUT', body: b }); App.toast('Settings saved'); settings(); });
  } catch { failed(settings); }
}

// ---------- one click handler for all table buttons ----------
V.addEventListener('click', (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const { a, id, s } = b.dataset, g = guard;
  if (a === 'edit') { const route = location.hash;
    if (route === '#/restaurants') { const r = rests.find((x) => x.id === id); formModal('Edit restaurant', RF, r, async (v) => { await A('/restaurants/' + id, { method: 'PATCH', body: v }); App.toast('Saved'); restaurants(); }); }
    else { const f = foods.find((x) => x.id === id); formModal('Edit dish', FF(rests), f, async (v) => { await A('/foods/' + id, { method: 'PATCH', body: v }); App.toast('Saved'); foodsView(); }); } }
  else if (a === 'toggle') { const r = rests.find((x) => x.id === id), to = r.status === 'active' ? 'inactive' : 'active';
    confirmDo(`${to === 'inactive' ? 'Deactivate' : 'Activate'} ${r.name}? ${to === 'inactive' ? 'Customers will stop seeing it.' : ''}`, async () => { await A('/restaurants/' + id, { method: 'PATCH', body: { status: to } }); restaurants(); }); }
  else if (a === 'del') { const isR = location.hash === '#/restaurants';
    confirmDo(isR ? 'Delete this restaurant and all its dishes? This can’t be undone.' : 'Delete this dish?', async () => { await A((isR ? '/restaurants/' : '/foods/') + id, { method: 'DELETE' }); App.toast('Deleted'); isR ? restaurants() : foodsView(); }); }
  else if (a === 'avail') { const f = foods.find((x) => x.id === id); g(async () => { await A('/foods/' + id, { method: 'PATCH', body: { availability: !f.availability } }); foodsView(); })(); }
  else if (a === 'detail') orderDetail(orderList.find((x) => x.id === id));
  else if (a === 'verifyupi') {
    const o = orderList.find((x) => x.id === id);
    formModal('Verify UPI payment', [{ name: 'transaction_reference', label: 'UPI transaction reference / UTR', required: true, ph: 'Check this in your UPI app before confirming' }], {}, async (v) => {
      await A(`/orders/${id}/verify-upi`, { method: 'POST', body: v });
      App.toast('UPI payment verified; order released to restaurant');
      ordersView(true);
    });
  }
  else if (a === 'refund') confirmDo('Refund this payment to the customer’s original payment method?', async () => { const r = await A(`/orders/${id}/refund`, { method: 'POST' }); statusToast({ refund: r.refund }); ordersView(true); });
  else if (['accepted', 'preparing', 'ready'].includes(a)) g(async () => { statusToast(await setStatus(id, a)); ordersView(true); })();
  else if (a === 'rejected' || a === 'cancelled') formModal(a === 'rejected' ? 'Reject order' : 'Cancel order', [{ name: 'reason', label: 'Reason (the customer will see this)', type: 'textarea', required: true }], {},
    async (v) => { statusToast(await setStatus(id, a, v.reason)); ordersView(true); });
  else if (a === 'cstatus') confirmDo(s === 'suspended' ? 'Suspend this customer? They won’t be able to order.' : 'Reactivate this customer?', async () => { await A('/customers/' + id, { method: 'PATCH', body: { status: s } }); customers(); });
  else if (a === 'corders') g(async () => { const { orders } = await A(`/customers/${id}/orders`); const d = $('#dlg');
    d.innerHTML = `<h3>Order history</h3>${orders.length ? `<table>${orders.map((o) => `<tr><td>${shortId(o.id)}<div class="sub">${when(o.created_at)}</div></td><td>${esc(o.restaurants?.name)}</td><td>${rupee(o.total)}</td><td>${pill(o.order_status)}</td></tr>`).join('')}</table>` : empty('No orders yet.')}<div class="actions"><button class="btn ghost" id="cx">Close</button></div>`;
    $('#cx').onclick = () => d.close(); d.showModal(); })();
  else if (a === 'pstatus') confirmDo(`Set this rider to "${s}"?`, async () => { await A('/partners/' + id, { method: 'PATCH', body: { approval_status: s } }); partners(); });
  else if (a === 'cresolve') g(async () => { await A('/complaints/' + id, { method: 'PATCH', body: { status: 'resolved' } }); complaints(); })();
  else if (a === 'ctoggle') g(async () => { await A('/coupons/' + id, { method: 'PATCH', body: { active: s === '1' } }); coupons(); })();
});

// ---------- routing, new-order alerts, startup ----------
const ROUTES = { '': dashboard, restaurants, foods: foodsView, orders: () => ordersView(), customers, partners, earnings, coupons, settings, complaints };
function route() {
  const r = location.hash.replace(/^#\/?/, '');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', (a.dataset.r === 'dashboard' ? '' : a.dataset.r) === r));
  (ROUTES[r] || dashboard)();
}
async function poll() { // checks for new orders every 10 seconds (instant updates arrive in Phase 6)
  try {
    const { orders } = await A('/orders?status=placed');
    const nb = $('#nb'); nb.textContent = orders.length; nb.classList.toggle('hidden', !orders.length);
    if (lastPlaced !== null && orders.length > lastPlaced) App.toast('New order received');
    if (lastPlaced !== null && orders.length !== lastPlaced && location.hash === '#/orders' && !$('#dlg').open) ordersView(true);
    lastPlaced = orders.length;
  } catch { /* try again next time */ }
}
(async () => {
  try {
    const sb = await App.supabase();
    const { data } = await sb.auth.getSession();
    if (!data.session) return location.replace('/');
    const { user } = await App.api('/auth/me');
    if (user.role !== 'admin') return location.replace('/');
  } catch { return location.replace('/'); }
  $('#logout').onclick = async () => { await (await App.supabase()).auth.signOut(); location.href = '/'; };
  addEventListener('hashchange', route); route(); poll(); setInterval(poll, 30000); // slow safety-net poll
  let t;
  App.live('admin', [{ table: 'order_status_history', event: 'INSERT' }, { table: 'delivery_partners', event: 'UPDATE' }], (table, p) => {
    clearTimeout(t);
    t = setTimeout(() => {
      const h = location.hash;
      if (table === 'delivery_partners') {
        const n = p?.new, m = n && pmarkers[n.id];
        if (m && n.current_latitude != null && h === '#/partners' && cachedAvail[n.id] === n.availability) { m.setLatLng([n.current_latitude, n.current_longitude]); return; } // just a position update
        if (h === '#/partners') partners(true);
        return;
      }
      poll();                                              // new-order badge + toast
      if (h === '#/orders') ordersView(true); else if (h === '' || h === '#/') dashboard(true);
    }, 300);
  });
})();

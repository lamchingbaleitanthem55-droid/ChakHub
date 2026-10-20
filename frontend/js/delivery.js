const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const when = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const R = (p, o) => App.api('/delivery' + p, o);
const V = $('#view');
let timer = null, watchId = null, lastSent = 0, loc = 'off', online = false, rmap = null, rmark = null, lastPos = null, RL = null;

const loading = () => { V.innerHTML = '<div class="sk"></div><div class="sk"></div>'; };
const failed = (fn) => { V.innerHTML = '<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><p>Couldn\'t load this. Check your connection and try again.</p><button class="btn" id="retry">Try again</button></div>'; $('#retry').onclick = fn; };
const mapsLink = (text, lat, lng) => 'https://www.google.com/maps/dir/?api=1&destination=' + (lat != null && lng != null ? `${lat},${lng}` : encodeURIComponent(text));
const declined = () => JSON.parse(sessionStorage.getItem('declined') || '[]'); // hidden for this session only

function setOnline(v) { online = v; const d = $('#dot'); d.textContent = v ? 'Online' : 'Offline'; d.classList.toggle('on', v); }
let lastBadge = null;
function badge(n) {
  if (lastBadge !== null && n > lastBadge) { App.toast('New delivery request'); navigator.vibrate?.(200); }
  lastBadge = n;
  const b = $('#nb'); b.textContent = n; b.classList.toggle('hidden', !n);
}
async function refreshBadge() { try { const d = await R('/requests'); badge(d.requests.filter((r) => !declined().includes(r.id)).length); } catch { /* next event will retry */ } }

// ---------- live location: only while a delivery is active, only with permission ----------
function startTracking() {
  if (watchId !== null) return;
  if (!navigator.geolocation) { loc = 'unsupported'; return; }
  watchId = navigator.geolocation.watchPosition((p) => {
    loc = 'on'; lastPos = [p.coords.latitude, p.coords.longitude]; moveRider();
    if (Date.now() - lastSent < 15000) return;
    lastSent = Date.now();
    R('/location', { method: 'POST', body: { latitude: p.coords.latitude, longitude: p.coords.longitude } }).catch(() => {});
  }, (err) => { loc = err.code === 1 ? 'denied' : 'error'; }, { enableHighAccuracy: true, maximumAge: 10000 });
}
function stopTracking() { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; loc = 'off'; }

// ---------- map on the active delivery ----------
function moveRider() {
  if (!rmap || !lastPos || !RL) return;
  rmark ? rmark.setLatLng(lastPos) : (rmark = App.pin(RL, lastPos, '#FC8019', 'You').addTo(rmap));
}
async function drawRiderMap(o) {
  const el = $('#rmap'); if (!el) return;
  try {
    RL = await App.leaflet();
    if (rmap) rmap.remove();
    rmark = null; rmap = RL.map(el).setView([24.817, 93.937], 13); App.tiles(RL).addTo(rmap);
    const pts = [];
    [[o.restaurants.latitude, o.restaurants.longitude, '#6b6b6b', 'Restaurant'], [o.address.latitude, o.address.longitude, '#1a8f4c', 'Customer']].forEach(([a, b, c, l]) => {
      if (a != null && b != null) { pts.push([a, b]); App.pin(RL, [a, b], c, l).addTo(rmap); }
    });
    if (lastPos) pts.push(lastPos);
    if (pts.length) rmap.fitBounds(pts, { padding: [30, 30], maxZoom: 16 }); else el.parentElement.classList.add('hidden');
    moveRider();
  } catch { el.parentElement.classList.add('hidden'); }
}

// ---------- map of the rider's zones ----------
let zoneMap = null;
async function drawZoneMap(areas) {
  const el = $('#zmap'); if (!el || !areas || !areas.length) return;
  try {
    const L = await App.leaflet();
    if (zoneMap) zoneMap.remove();
    zoneMap = L.map(el, { zoomControl: false }).setView([areas[0].lat, areas[0].lng], 13); App.tiles(L).addTo(zoneMap);
    const boxes = areas.map((a) => L.circle([a.lat, a.lng], { radius: a.radius_km * 1000, color: '#FC8019', weight: 2, fillOpacity: 0.12 }).bindTooltip(a.name).addTo(zoneMap).getBounds());
    zoneMap.fitBounds(boxes.reduce((acc, b) => acc.extend(b)), { padding: [20, 20] });
  } catch { el.parentElement.classList.add('hidden'); }
}

// ---------- Dashboard ----------
async function dashboard(quiet) {
  if (!quiet) loading();
  try {
    const d = await R('/dashboard');
    setOnline(d.partner.availability === 'online');
    d.has_active ? startTracking() : stopTracking();
    badge(d.waiting);
    V.innerHTML = `<h1>Hi, ${esc(d.user.name.split(' ')[0])} 👋</h1>
      <button class="switch ${online ? 'on' : ''}" id="tog" role="switch" aria-checked="${online}"><span>${online ? 'You’re online' : 'You’re offline'}</span><span class="knob"></span></button>
      <p class="sub" style="margin:8px 4px 16px">${online ? 'You’ll see new delivery requests as they come in.' : 'Go online to receive delivery requests.'}</p>
      <p class="sub" style="margin:-8px 4px 16px"><i class="fa-solid fa-location-dot"></i> ${d.zones && d.zones.length ? 'Your zones: ' + esc(d.zones.join(', ')) : 'You can take orders from all areas'}</p>
      ${d.zone_areas && d.zone_areas.length ? '<div class="card" style="padding:0;overflow:hidden"><div id="zmap" style="height:200px"></div></div>' : ''}
      ${d.has_active ? '<a class="card" href="#/active" style="display:block;border-color:var(--brand)"><b>You have an active delivery</b><div class="sub">Tap to continue →</div></a>'
        : online && d.waiting ? `<a class="card" href="#/requests" style="display:block;border-color:var(--ok)"><b>${d.waiting} order${d.waiting > 1 ? 's' : ''} waiting for pickup</b><div class="sub">Tap to view →</div></a>` : ''}
      <div class="grid"><div class="stat"><span>Today</span><b>${rupee(d.stats.today)}</b></div><div class="stat"><span>Total earned</span><b>${rupee(d.stats.total)}</b></div>
        <div class="stat"><span>Deliveries done</span><b>${d.stats.completed}</b></div><div class="stat"><span>Vehicle</span><b style="font-size:1rem;text-transform:capitalize">${esc(d.partner.vehicle_type)}</b></div></div>`;
    drawZoneMap(d.zone_areas);
    $('#tog').onclick = async (e) => {
      e.currentTarget.disabled = true;
      try { await R('/availability', { method: 'PATCH', body: { availability: online ? 'offline' : 'online' } }); } catch (er) { App.toast(er.message, 'error'); }
      dashboard();
    };
  } catch (e) { handleAuth(e) || (quiet || failed(dashboard)); }
}

// ---------- Requests ----------
async function requests(quiet) {
  if (!quiet) loading();
  try {
    const d = await R('/requests');
    setOnline(d.online);
    const list = d.requests.filter((r) => !declined().includes(r.id));
    badge(list.length);
    V.innerHTML = `<h1>Delivery requests</h1>${!d.online ? '<div class="empty"><i class="fa-solid fa-power-off"></i><p>You’re offline. Go online from the dashboard to receive requests.</p><a class="btn" href="#/">Go to dashboard</a></div>'
      : list.length ? list.map((r) => `<div class="card"><div class="row"><div><b>${esc(r.restaurant)}</b><div class="sub">Pickup: ${esc(r.pickup)}</div><div class="sub">Deliver to: ${esc(r.drop_area)}</div></div><div class="pay">${rupee(r.payout)}</div></div>
        ${r.cash ? `<div class="sub" style="margin-top:6px">Cash to collect: ${rupee(r.cash)}</div>` : ''}<div class="sub">Ready since ${when(r.ready_since)}</div>
        <div class="two"><button class="btn ghost" data-a="decline" data-id="${esc(r.id)}">DECLINE</button><button class="btn good" data-a="accept" data-id="${esc(r.id)}">ACCEPT</button></div></div>`).join('')
      : '<div class="empty"><i class="fa-solid fa-bell-slash"></i><p>No orders are waiting right now. This page updates automatically.</p></div>'}`;
    timer = setTimeout(() => requests(true), 20000); // safety net; live updates arrive instantly
  } catch (e) { if (!quiet) handleAuth(e) || failed(requests); else timer = setTimeout(() => requests(true), 15000); }
}

// ---------- Active delivery ----------
const LABELS = ['Navigate to restaurant', 'Arrived at restaurant', 'Pickup confirmed', 'Delivery started', 'Arrived at customer', 'Delivered'];
const AT = { assigned: 0, at_restaurant: 1, picked_up: 2, out_for_delivery: 3, at_customer: 4 };
const ACTION = { assigned: ['arrived_restaurant', 'I’ve arrived at the restaurant'], at_restaurant: ['pickup', 'Confirm pickup'], picked_up: ['start_delivery', 'Start delivery'],
  out_for_delivery: ['arrived_customer', 'I’ve arrived at the customer'], at_customer: ['complete', 'Confirm delivery'] };
const LOCNOTE = { on: '', denied: 'Location sharing is blocked. Allow location in your browser settings so customers can follow your delivery.', unsupported: 'This device can’t share location.', error: 'We couldn’t get your location right now.', off: 'Waiting for location permission…' };

async function active(quiet) {
  const keepOtp = quiet && $('#otp') ? $('#otp').value : '';
  if (!quiet) loading();
  try {
    const d = await R('/active');
    if (!d.order) { stopTracking(); V.innerHTML = '<h1>Active order</h1><div class="empty"><i class="fa-solid fa-route"></i><p>You have no active delivery.</p><a class="btn" href="#/requests">See requests</a></div>'; return; }
    startTracking();
    const o = d.order, at = AT[d.step], [act, label] = ACTION[d.step], toCustomer = at >= 2;
    const target = toCustomer ? mapsLink(o.address.full_address, o.address.latitude, o.address.longitude) : mapsLink(o.restaurants.address, o.restaurants.latitude, o.restaurants.longitude);
    V.innerHTML = `<h1>Active order</h1>
      <div class="card" style="padding:0;overflow:hidden"><div id="rmap" style="height:220px"></div></div>
      <div class="card"><div class="row"><b>Order #${esc(o.id.slice(0, 8).toUpperCase())}</b><span class="pay">${rupee(d.payout)}</span></div>
        <ul class="steps" style="margin-top:10px">${LABELS.map((l, i) => `<li class="${i < at ? 'done' : i === at ? 'now' : ''}"><i class="fa-solid ${i < at ? 'fa-circle-check' : i === at ? 'fa-circle-dot' : 'fa-circle'}"></i>${l}</li>`).join('')}</ul>
        ${d.cash && at >= 3 ? `<div class="cash">Collect ${rupee(d.cash)} in cash from the customer</div>` : ''}
        <a class="btn ghost" href="${esc(target)}" target="_blank" rel="noopener"><i class="fa-solid fa-location-arrow"></i> Navigate to ${toCustomer ? 'customer' : 'restaurant'}</a>
        <div style="height:10px"></div>
        ${act === 'complete' ? '<input class="otp" id="otp" inputmode="numeric" maxlength="4" placeholder="••••" aria-label="Customer code" autocomplete="one-time-code">' : ''}
        <button class="btn" id="go">${esc(label)}</button>
        ${LOCNOTE[loc] ? `<p class="note" style="margin:12px 0 0">${esc(LOCNOTE[loc])}</p>` : ''}</div>
      <div class="card"><h3>Pickup</h3><b>${esc(o.restaurants.name)}</b><div class="sub">${esc(o.restaurants.address)}</div>
        ${o.restaurants.phone ? `<p><a href="tel:${esc(o.restaurants.phone.replace(/[^\d+]/g, ''))}" style="color:var(--brand);font-weight:700"><i class="fa-solid fa-phone"></i> Call restaurant</a></p>` : ''}</div>
      <div class="card"><h3>Deliver to</h3><b>${esc(o.users?.name)}</b><div class="sub">${esc(o.address.label)}: ${esc(o.address.full_address)}</div>
        ${o.delivery_instructions ? `<div class="note" style="margin-top:8px">Note: ${esc(o.delivery_instructions)}</div>` : ''}
        ${o.users?.phone ? `<p><a href="tel:${esc(o.users.phone.replace(/[^\d+]/g, ''))}" style="color:var(--brand);font-weight:700"><i class="fa-solid fa-phone"></i> Call customer</a></p>` : ''}</div>
      <div class="card"><h3>Items</h3>${o.items.map((i) => `<div class="line"><span>${i.qty} × ${esc(i.name)}${(i.options || []).length ? `<div class="sub">${esc(i.options.join(' · '))}</div>` : ''}${i.note ? `<div class="sub">“${esc(i.note)}”</div>` : ''}</span></div>`).join('')}</div>`;
    drawRiderMap(o);
    if (keepOtp && $('#otp')) { $('#otp').value = keepOtp; $('#otp').focus(); } // don't wipe a code being typed
    $('#go').onclick = async (e) => {
      const body = { step: act };
      if (act === 'complete') { body.otp = $('#otp').value.trim(); if (!/^\d{4}$/.test(body.otp)) return App.toast('Enter the customer’s 4-digit code', 'error'); }
      e.currentTarget.disabled = true;
      try {
        const r = await R('/active/step', { method: 'POST', body });
        if (act === 'complete') { stopTracking(); App.toast(`Delivered! You earned ${rupee(r.earned)}`); location.hash = '#/'; return; }
      } catch (er) { App.toast(er.message, 'error'); }
      active();
    };
  } catch (e) { handleAuth(e) || (quiet || failed(active)); }
}

// ---------- Earnings ----------
async function earnings() {
  loading();
  try {
    const e = await R('/earnings');
    V.innerHTML = `<h1>Earnings</h1><div class="grid"><div class="stat"><span>Today</span><b>${rupee(e.today)}</b></div><div class="stat"><span>Last 7 days</span><b>${rupee(e.week)}</b></div>
      <div class="stat"><span>Last 30 days</span><b>${rupee(e.month)}</b></div><div class="stat"><span>All time (${e.count})</span><b>${rupee(e.total)}</b></div></div>
      <div class="card"><h3>Payment history</h3>${e.history.length ? e.history.map((h) => `<div class="line"><span>${esc(h.restaurant || 'Delivery')}<div class="sub">${when(h.delivery_time)}</div></span><b>${rupee(h.earnings)}</b></div>`).join('')
        : '<div class="empty" style="padding:20px"><p>Completed deliveries will show up here.</p></div>'}</div>`;
  } catch (er) { handleAuth(er) || failed(earnings); }
}

// ---------- Profile ----------
async function profile() {
  loading();
  try {
    const d = await R('/dashboard');
    V.innerHTML = `<h1>Profile</h1><form class="card" id="pf"><label>Name<input class="field" name="name" value="${esc(d.user.name)}" required minlength="2"></label>
      <label>Phone<input class="field" name="phone" value="${esc(d.user.phone)}" required></label><label>Email<input class="field" value="${esc(d.user.email)}" disabled></label>
      <label>Vehicle<select class="field" name="vehicle_type">${['bike', 'scooter', 'bicycle'].map((v) => `<option value="${v}" ${v === d.partner.vehicle_type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Vehicle number<input class="field" name="vehicle_number" value="${esc(d.partner.vehicle_number || '')}" maxlength="20"></label>
      <button class="btn">Save changes</button></form><div class="card"><div class="row"><span>Account status</span><b style="color:var(--ok)">Approved</b></div></div>
      <button class="btn ghost" id="out"><i class="fa-solid fa-right-from-bracket"></i> Log out</button>`;
    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      try { await R('/profile', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); App.toast('Profile saved'); } catch (er) { App.toast(er.message, 'error'); }
    };
    $('#out').onclick = async () => {
      if (online && !confirm('You’re still online. Log out anyway?')) return;
      try { await R('/availability', { method: 'PATCH', body: { availability: 'offline' } }); } catch (er) { if (/delivery/i.test(er.message)) return App.toast(er.message, 'error'); }
      stopTracking(); await (await App.supabase()).auth.signOut(); location.href = '/';
    };
  } catch (e) { handleAuth(e) || failed(profile); }
}

// ---------- decline / accept buttons, routing, startup ----------
V.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]'); if (!b) return;
  if (b.dataset.a === 'decline') { sessionStorage.setItem('declined', JSON.stringify([...declined(), b.dataset.id])); clearTimeout(timer); requests(); }
  if (b.dataset.a === 'accept') {
    b.disabled = true;
    try { await R(`/requests/${b.dataset.id}/accept`, { method: 'POST' }); App.toast('Delivery accepted'); location.hash = '#/active'; }
    catch (er) { App.toast(er.message, 'error'); clearTimeout(timer); requests(); }
  }
});

const ROUTES = { '': dashboard, requests: () => requests(), active, earnings, profile };
function route() {
  clearTimeout(timer);
  const r = location.hash.replace(/^#\/?/, '');
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.r === r));
  (ROUTES[r] || dashboard)();
}
function handleAuth(e) { if (/approval|log in|expired|not allowed/i.test(e.message)) { location.replace('/'); return true; } return false; }

(async () => {
  try {
    const sb = await App.supabase();
    const { data } = await sb.auth.getSession();
    if (!data.session) return location.replace('/');
    const { user, partner } = await App.api('/auth/me');
    if (user.role !== 'delivery' || partner?.approval_status !== 'approved') return location.replace('/');
  } catch { return location.replace('/'); }
  addEventListener('hashchange', route); route();
  let t;
  App.live('rider', [{ table: 'order_status_history', event: 'INSERT' }], () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const r = location.hash.replace(/^#\/?/, '');
      if (r === 'requests') requests(true); else if (r === 'active') active(true); else if (r === '') dashboard(true); else refreshBadge();
    }, 300);
  });
})();

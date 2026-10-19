const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupee = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const CATS = [['Pizza','fa-pizza-slice'],['Burgers','fa-burger'],['Biryani','fa-bowl-rice'],['Chinese','fa-bowl-food'],['Indian','fa-pepper-hot'],
  ['South Indian','fa-leaf'],['Fast Food','fa-hotdog'],['Desserts','fa-ice-cream'],['Beverages','fa-mug-hot'],['Healthy Food','fa-apple-whole']];
const FILTERS = [['rating','Rating 4.0+'],['veg','Pure veg'],['offers','Offers'],['lowFee','Delivery ≤ ₹30'],['budget','Under ₹250'],['fav','♥ Favourites']];

const view = $('#view');
const state = { q: '', category: '', sort: 'rating', on: new Set() };
let me, cfg = {}, favs = new Set();

const img = (src, alt) => src ? `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : '';
view.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('noimg'); }, true);
const heart = (id) => `<button class="heart ${favs.has(id) ? 'on' : ''}" data-fav="${esc(id)}" aria-label="Favourite" aria-pressed="${favs.has(id)}"><i class="fa-${favs.has(id) ? 'solid' : 'regular'} fa-heart"></i></button>`;

function skeleton() { view.innerHTML = `<div class="grid">${'<div class="sk"></div>'.repeat(6)}</div>`; }
function failed(retry) {
  view.innerHTML = `<div class="err"><i class="fa-solid fa-triangle-exclamation"></i><p>We couldn't load this. Check your connection and try again.</p><button id="retry">Try again</button></div>`;
  $('#retry').onclick = retry;
}

// favourite hearts work everywhere on the page
view.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-fav]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const id = b.dataset.fav, on = !favs.has(id);
  try {
    await App.api('/favorites/' + id, { method: on ? 'POST' : 'DELETE' });
    on ? favs.add(id) : favs.delete(id);
    document.querySelectorAll(`[data-fav="${id}"]`).forEach((x) => { x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); x.querySelector('i').className = `fa-${on ? 'solid' : 'regular'} fa-heart`; });
    if (state.on.has('fav') && $('#list')) loadList();
  } catch (er) { App.toast(er.message, 'error'); }
});

// ---------- Home ----------
function renderHome() {
  view.innerHTML = `
    <label class="search"><i class="fa-solid fa-magnifying-glass"></i>
      <input id="q" type="search" placeholder="Search restaurants or dishes" value="${esc(state.q)}" aria-label="Search"></label>
    <div id="promos" class="promos"></div>
    <div id="again"></div>
    <h2>What are you craving?</h2>
    <div class="cats">${CATS.map(([n, i]) => `<button class="cat" data-cat="${esc(n)}" aria-pressed="${state.category === n}"><i class="fa-solid ${i}"></i>${esc(n)}</button>`).join('')}</div>
    <h2 id="list-title">Restaurants near you</h2>
    <div class="filters">
      ${FILTERS.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${state.on.has(k)}">${l}</button>`).join('')}
      <select class="chip" id="sort" aria-label="Sort"><option value="rating">Top rated</option><option value="fee">Lowest delivery fee</option><option value="price">Lowest price</option></select>
    </div>
    <div id="list" style="margin-top:18px"></div>`;
  $('#sort').value = state.sort;
  let t;
  $('#q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; loadList(); }, 300); };
  $('#sort').onchange = (e) => { state.sort = e.target.value; loadList(); };
  document.querySelectorAll('.cat').forEach((b) => b.onclick = () => {
    state.category = state.category === b.dataset.cat ? '' : b.dataset.cat;
    document.querySelectorAll('.cat').forEach((x) => x.setAttribute('aria-pressed', x.dataset.cat === state.category));
    loadList();
  });
  document.querySelectorAll('.chip[data-f]').forEach((b) => b.onclick = () => {
    state.on.has(b.dataset.f) ? state.on.delete(b.dataset.f) : state.on.add(b.dataset.f);
    b.setAttribute('aria-pressed', state.on.has(b.dataset.f));
    loadList();
  });
  loadList(); loadPromos(); loadAgain();
}

async function loadPromos() {
  try {
    const { promos } = await App.api('/restaurants/promos', { auth: false });
    const el = $('#promos'); if (!el || !promos.length) return;
    el.innerHTML = promos.map((p) => `<div class="promo"><b>${esc(p.code)}</b><span>${p.discount_type === 'percent' ? esc(p.discount_value) + '% off' : rupee(p.discount_value) + ' off'}${Number(p.minimum_order) ? ' above ' + rupee(p.minimum_order) : ''}</span></div>`).join('');
  } catch { /* promos are optional */ }
}
async function loadAgain() {
  try {
    const { orders } = await App.api('/orders');
    const seen = new Set();
    const picks = orders.filter((o) => o.order_status === 'delivered').filter((o) => !seen.has(o.restaurants?.name) && seen.add(o.restaurants?.name)).slice(0, 3);
    const el = $('#again'); if (!el || !picks.length) return;
    el.innerHTML = `<h2>Order again</h2><div class="again">${picks.map((o) => `<div class="ordercard"><strong>${esc(o.restaurants?.name)}</strong><div class="sub">${esc(o.items.map((i) => `${i.qty} × ${i.name}`).join(', '))}</div><p style="margin:8px 0 0"><button class="link" data-act="reorder" data-id="${esc(o.id)}">Reorder</button></p></div>`).join('')}</div>`;
  } catch { /* optional */ }
}

async function loadList() {
  const list = $('#list');
  list.innerHTML = '<div class="grid">' + '<div class="sk"></div>'.repeat(3) + '</div>';
  const p = new URLSearchParams({ sort: state.sort });
  if (state.q.trim()) p.set('q', state.q.trim());
  if (state.category) p.set('category', state.category);
  if (state.on.has('rating')) p.set('minRating', 4);
  if (state.on.has('veg')) p.set('veg', 1);
  if (state.on.has('offers')) p.set('offers', 1);
  if (state.on.has('lowFee')) p.set('maxFee', 30);
  if (state.on.has('budget')) p.set('maxPrice', 250);
  try {
    let { restaurants } = await App.api('/restaurants?' + p, { auth: false });
    if (!$('#list')) return;
    if (state.on.has('fav')) restaurants = restaurants.filter((r) => favs.has(r.id));
    if (!restaurants.length) {
      list.innerHTML = `<div class="empty"><i class="fa-solid fa-utensils"></i><p>No restaurants match. Try removing a filter or searching something else.</p></div>`;
      return;
    }
    list.innerHTML = `<div class="grid">${restaurants.map(card).join('')}</div>`;
  } catch { list.innerHTML = `<div class="err"><i class="fa-solid fa-triangle-exclamation"></i><p>Couldn't load restaurants. Check your connection and try again.</p><button id="retry">Try again</button></div>`; $('#retry').onclick = loadList; }
}

const card = (r) => `
  <a class="card ${r.is_open ? '' : 'closed'}" href="#/r/${esc(r.id)}">
    <div class="pic">${img(r.image, r.name)}${r.is_open ? (r.offer ? `<span class="badge">${esc(r.offer)}</span>` : '') : '<span class="badge off">Closed</span>'}${heart(r.id)}</div>
    <div class="info"><h3>${esc(r.name)}</h3>
      <div class="sub">${esc(r.cuisine.join(', '))}</div>
      <div class="meta"><span class="star"><i class="fa-solid fa-star"></i> ${r.rating.toFixed(1)}</span>
        <span>${esc(r.delivery_time)}</span><span>${r.delivery_fee ? rupee(r.delivery_fee) + ' delivery' : 'Free delivery'}</span>${r.avg_price ? `<span>${rupee(r.avg_price)} avg</span>` : ''}</div>
      ${r.matched_dishes.length ? `<div class="dish">Has: ${esc(r.matched_dishes.join(', '))}</div>` : ''}
    </div></a>`;

// ---------- Restaurant page ----------
async function renderRestaurant(id, quiet) {
  if (!quiet) skeleton();
  try {
    const { restaurant: r, menu, reviews } = await App.api('/restaurants/' + encodeURIComponent(id), { auth: false });
    let vegOnly = false;
    const draw = () => {
      const items = menu.filter((m) => !vegOnly || m.is_veg);
      const groups = {};
      items.forEach((m) => (groups[m.category] ||= []).push(m));
      view.innerHTML = `
        <a class="back" href="#/"><i class="fa-solid fa-arrow-left"></i> All restaurants</a>
        <section class="hero"><div class="pic">${img(r.image, r.name)}${heart(r.id)}</div><div class="info">
          <h1 style="margin:0 0 4px">${esc(r.name)}</h1><div class="sub">${esc(r.description || '')}</div>
          <div class="meta"><span class="star"><i class="fa-solid fa-star"></i> ${r.rating.toFixed(1)}</span>
            <span>${esc(r.cuisine.join(', '))}</span><span>${esc(r.delivery_time)}</span>
            <span>${r.delivery_fee ? rupee(r.delivery_fee) + ' delivery' : 'Free delivery'}</span>
            <span>${r.is_open ? 'Open now' : 'Closed'} · ${esc(r.opening_time || '')}–${esc(r.closing_time || '')}</span></div>
          <div class="sub" style="margin-top:8px"><i class="fa-solid fa-location-dot"></i> ${esc(r.address)}</div></div></section>
        <div class="menu-head"><h2 style="margin:0">Menu</h2>
          <button class="chip" id="veg" aria-pressed="${vegOnly}">Veg only</button></div>
        ${Object.keys(groups).length ? Object.entries(groups).map(([c, arr]) => `<h2>${esc(c)}</h2>${arr.map(dish).join('')}`).join('')
          : '<div class="empty"><i class="fa-solid fa-bowl-food"></i><p>No dishes to show here yet.</p></div>'}
        <h2>Ratings &amp; reviews</h2>
        ${reviews.length ? reviews.map((v) => `<div class="review"><span class="stars">${'★'.repeat(v.rating)}${'☆'.repeat(5 - v.rating)}</span> <strong>${esc(v.name)}</strong>${v.comment ? `<div class="sub">${esc(v.comment)}</div>` : ''}</div>`).join('')
          : '<p class="sub">No reviews yet. Be the first after your order arrives.</p>'}`;
      $('#veg').onclick = () => { vegOnly = !vegOnly; draw(); };
      Cart.bindMenu(r, menu);
    };
    draw();
    if (!quiet) scrollTo(0, 0);
  } catch (e) {
    if (/not found/i.test(e.message)) view.innerHTML = `<div class="empty"><i class="fa-solid fa-store-slash"></i><p>This restaurant isn't available. <a href="#/" style="color:var(--brand);font-weight:700">Browse restaurants</a></p></div>`;
    else failed(() => renderRestaurant(id));
  }
}

const dish = (m) => {
  const sale = m.discount_percent > 0 ? m.price * (1 - m.discount_percent / 100) : null;
  const custom = Array.isArray(m.customizations) && m.customizations.length ? ' data-custom="1"' : '';
  return `<div class="item ${m.available ? '' : 'na'}"><div>
    <span class="dot ${m.is_veg ? '' : 'nv'}" title="${m.is_veg ? 'Veg' : 'Non-veg'}"></span>
    <h4>${esc(m.name)}</h4>
    <div class="price">${rupee(Math.round(sale ?? m.price))}${sale ? `<s>${rupee(m.price)}</s>` : ''}${m.available ? '' : ' · Unavailable'}</div>
    <div class="sub">${esc(m.description || '')}</div>${m.available ? `<div class="addwrap" data-id="${esc(m.id)}"${custom}></div>` : ''}</div>
    ${m.image ? `<div class="pic">${img(m.image, m.name)}</div>` : ''}</div>`;
};

// ---------- Profile ----------
async function showProfile(quiet) {
  if (!quiet) skeleton();
  try {
    const [{ user }, { addresses }, { restaurants: favList }] = await Promise.all([App.api('/auth/me'), App.api('/addresses'), App.api('/favorites')]);
    view.innerHTML = `<div class="narrow"><h1 style="margin:0 0 14px">My profile</h1>
      <form class="panel" id="pf"><h3>Details</h3>
        <label class="stack">Name<input class="field" name="name" value="${esc(user.name)}" required minlength="2"></label>
        <label class="stack">Phone<input class="field" name="phone" value="${esc(user.phone)}" required></label>
        <label class="stack">Email<input class="field" value="${esc(user.email)}" disabled></label>
        <button class="addbtn">Save changes</button></form>
      <div class="panel"><h3>Saved addresses</h3>${addresses.length ? addresses.map((a) => `<div class="line"><div class="grow"><strong>${esc(a.label)}</strong><div class="sub">${esc(a.full_address)}</div></div><button class="link" data-deladdr="${esc(a.id)}">Delete</button></div>`).join('')
        : '<p class="sub">No saved addresses yet. You can add one at checkout.</p>'}</div>
      <div class="panel"><h3>Favourite restaurants</h3>${favList.length ? favList.map((f) => `<div class="line"><a href="#/r/${esc(f.id)}" class="grow"><strong>${esc(f.name)}</strong><div class="sub">${esc((f.cuisine || []).join(', '))}</div></a>${heart(f.id)}</div>`).join('')
        : '<p class="sub">Tap the heart on a restaurant to save it here.</p>'}</div>
      <div class="panel"><h3>Help &amp; support</h3><p class="sub">${cfg.support_phone ? `Call us on <a style="color:var(--brand);font-weight:700" href="tel:${esc(String(cfg.support_phone).replace(/[^\d+]/g, ''))}">${esc(cfg.support_phone)}</a>. ` : ''}Open any order and tap “Report a problem” to reach us.</p></div>
      <p><a class="addbtn" href="#/orders">My orders</a> <button class="btn-line" id="p-out">Log out</button></p></div>`;
    $('#pf').onsubmit = async (e) => {
      e.preventDefault();
      try { const f = Object.fromEntries(new FormData(e.target)); const r = await App.api('/auth/me', { method: 'PATCH', body: { name: f.name, phone: f.phone } }); me = { ...me, ...r.user }; $('#me-name').textContent = me.name; App.toast('Profile saved'); }
      catch (er) { App.toast(er.message, 'error'); }
    };
    $('#p-out').onclick = logout;
    document.querySelectorAll('[data-deladdr]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this address?')) return;
      try { await App.api('/addresses/' + b.dataset.deladdr, { method: 'DELETE' }); showProfile(true); } catch (er) { App.toast(er.message, 'error'); }
    });
  } catch { failed(showProfile); }
}

// ---------- Notifications ----------
function setBell(n) { const b = $('#bell'); b.textContent = n > 9 ? '9+' : n; b.classList.toggle('hidden', !n); }
async function refreshBell() { try { setBell((await App.api('/notifications')).unread); } catch { /* shows next time */ } }
async function showNotifications(quiet) {
  if (!quiet) skeleton();
  try {
    const { notifications: list } = await App.api('/notifications');
    const canAsk = 'Notification' in window && Notification.permission === 'default';
    view.innerHTML = `<div class="narrow"><h1 style="margin:0 0 14px">Notifications</h1>
      ${canAsk ? '<div class="note">Get alerts when your order moves along, even if this tab is in the background. <button class="link" id="enable-n">Turn on</button></div>' : ''}
      ${list.length ? list.map((n) => `<div class="panel" style="${n.read_status ? '' : 'border-color:var(--brand)'}"><strong>${esc(n.title)}</strong><div class="sub">${esc(n.message)}</div><div class="sub">${esc(new Date(n.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }))}</div></div>`).join('')
        : '<div class="empty"><i class="fa-solid fa-bell"></i><p>Nothing yet. Order updates will show up here.</p></div>'}</div>`;
    $('#enable-n')?.addEventListener('click', async () => { await Notification.requestPermission(); showNotifications(true); });
    await App.api('/notifications/read', { method: 'POST' }); setBell(0);
  } catch { failed(showNotifications); }
}

// ---------- Live updates ----------
function startLive() {
  let t;
  App.live('customer-' + me.id, [
    { table: 'notifications', event: 'INSERT', filter: `user_id=eq.${me.id}` },
    { table: 'order_status_history', event: 'INSERT' },
    { table: 'food_items' }, { table: 'restaurants' },
  ], (table, p) => {
    if (table === 'notifications') {
      App.toast(`${p.new.title}: ${p.new.message}`); refreshBell();
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(p.new.title, { body: p.new.message });
      if (location.hash === '#/notifications') showNotifications(true);
      return;
    }
    clearTimeout(t);
    t = setTimeout(() => {
      Cart.refresh();                                   // order page / order list, if open
      if (table === 'order_status_history') return;
      Cart.reload();                                    // prices or availability may have changed
      if ($('#list')) loadList(); else if (/^#\/r\//.test(location.hash)) renderRestaurant(location.hash.slice(4), true);
    }, 400);
  });
}

// ---------- Routing, profile menu, startup ----------
function route() {
  Cart.stop();
  const h = location.hash;
  let m;
  if ((m = h.match(/^#\/r\/([\w-]+)/))) return renderRestaurant(m[1]);
  if (h === '#/cart') return Cart.show.cart();
  if (h === '#/checkout') return Cart.show.checkout();
  if (h === '#/orders') return Cart.show.orders();
  if ((m = h.match(/^#\/order\/([\w-]+)/))) return Cart.show.order(m[1]);
  if ((m = h.match(/^#\/receipt\/([\w-]+)/))) return Cart.show.receipt(m[1]);
  if (h === '#/notifications') return showNotifications();
  if (h === '#/profile') return showProfile();
  renderHome();
}

async function logout() { await (await App.supabase()).auth.signOut(); location.href = '/'; }

function wireChrome() {
  $('#me-name').textContent = me.name; $('#me-email').textContent = me.email;
  const menu = $('#profile-menu');
  $('#profile-btn').onclick = () => menu.classList.toggle('hidden');
  $('#nav-profile').onclick = () => menu.classList.toggle('hidden');
  $('#nav-search').onclick = () => { if (location.hash) location.hash = '#/'; setTimeout(() => $('#q')?.focus(), 50); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap, #nav-profile') || e.target.closest('#profile-menu a')) menu.classList.add('hidden'); });
  $('#logout-btn').onclick = logout;
}

function applyBrand() {
  const name = cfg.name || 'ChakHub';
  $('#brand-name').textContent = name; document.title = name + ' – Order food';
  if (cfg.logo_url) { const i = document.createElement('img'); i.src = cfg.logo_url; i.alt = ''; i.className = 'logo'; $('#brand-logo').replaceChildren(i); }
}

(async () => {
  try {
    const sb = await App.supabase();
    const { data } = await sb.auth.getSession();
    if (!data.session) return location.replace('/');
    const r = await App.api('/auth/me');
    if (r.user.role !== 'customer') return location.replace('/');
    me = r.user;
    await Cart.load();
  } catch { return location.replace('/'); }
  try { cfg = await (await fetch('/api/config')).json(); } catch { /* defaults */ }
  try { favs = new Set((await App.api('/favorites')).ids); } catch { /* hearts stay empty */ }
  applyBrand(); wireChrome(); refreshBell(); startLive();
  addEventListener('hashchange', route);
  route();
})();

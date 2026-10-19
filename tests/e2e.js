// End-to-end check of the whole platform against a RUNNING server and your real Supabase project.
//   1) npm run seed      (creates the test accounts and prints their password)
//   2) npm start         (in another terminal)
//   3) E2E_PASSWORD=<that password> npm run e2e      (or put E2E_PASSWORD in .env)
// It creates a throw-away restaurant, walks one order from sign-up to delivery, then deactivates the restaurant.
require('dotenv').config();
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
const PW = process.env.E2E_PASSWORD || process.env.SEED_PASSWORD;
if (!PW || !SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Set E2E_PASSWORD (the password printed by `npm run seed`) and the Supabase values in .env'); process.exit(1); }

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => { cond ? passed++ : failed++; console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${cond ? '' : extra ? '  -> ' + extra : ''}`); return cond; };
const section = (t) => console.log('\n' + t);

async function login(email, password = PW) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Could not log in as ${email}: ${j.error_description || j.msg || r.status}`);
  return j.access_token;
}
async function api(token, method, path, body) {
  const r = await fetch(BASE + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

(async () => {
  const stamp = Date.now();
  const admin = await login('admin@example.com');
  const rider1 = await login('rider@example.com');

  section('TEST 1  Customer registers and logs in');
  const email = `e2e+${stamp}@example.com`;
  const reg = await api(null, 'POST', '/auth/register', { name: 'E2E Customer', email, password: 'E2e-pass-123', phone: '9876543210', accountType: 'customer' });
  check('registration succeeds', reg.status === 201, JSON.stringify(reg.json));
  const cust = await login(email, 'E2e-pass-123');
  const me = await api(cust, 'GET', '/auth/me');
  check('login works and role is customer', me.json.user?.role === 'customer');
  check('self-signup cannot create an admin', (await api(null, 'POST', '/auth/register', { name: 'Evil', email: `evil+${stamp}@example.com`, password: 'Evil-pass-123', phone: '9876543211', accountType: 'admin' })).status === 400);

  section('TEST 2-3  Admin creates a restaurant and a food item');
  const rest = await api(admin, 'POST', '/admin/restaurants', { name: `E2E Kitchen ${stamp}`, address: 'Test Road, Imphal', cuisine: ['Pizza'], opening_time: '00:00', closing_time: '23:59', delivery_fee: 25, latitude: 24.81, longitude: 93.94 });
  check('restaurant created', rest.status === 201, JSON.stringify(rest.json));
  const rid = rest.json.restaurant?.id;
  const food = await api(admin, 'POST', '/admin/foods', { restaurant_id: rid, name: 'E2E Pizza', price: 199, category: 'Pizza', is_veg: true, availability: true, discount_percent: 0,
    customizations: [{ name: 'Size', type: 'one', options: [{ label: 'Regular', price: 0 }, { label: 'Large', price: 60 }] }] });
  check('food item created (with a size option)', food.status === 201, JSON.stringify(food.json));
  const fid = food.json.food?.id;

  section('TEST 4  Customer sees the new food item');
  const detail = await api(cust, 'GET', '/restaurants/' + rid);
  check('menu shows the new dish', detail.json.menu?.some((m) => m.id === fid));
  check('restaurant appears in the listing', (await api(cust, 'GET', '/restaurants?q=E2E')).json.restaurants?.some((r) => r.id === rid));

  section('TEST 5  Customer adds food to the cart (and cannot forge prices)');
  const cart = await api(cust, 'PUT', '/cart', { items: [{ food_id: fid, qty: 2, price: 1, options: [{ group: 'Size', label: 'Large' }] }] });
  check('cart total comes from the server: 2 x (199 + 60) = 518', cart.json.subtotal === 518, JSON.stringify(cart.json));
  check('a missing required option is not accepted', (await api(cust, 'PUT', '/cart', { items: [{ food_id: fid, qty: 1 }] })).json.lines?.length === 0);
  await api(cust, 'PUT', '/cart', { items: [{ food_id: fid, qty: 2, options: [{ group: 'Size', label: 'Large' }] }] });

  section('TEST 6  Customer places a Cash on Delivery order');
  const addr = await api(cust, 'POST', '/addresses', { label: 'Home', full_address: '12 Test Lane, Imphal, Manipur', latitude: 24.82, longitude: 93.95 });
  const placed = await api(cust, 'POST', '/orders', { address_id: addr.json.address?.id, payment_method: 'cod' });
  check('order placed', placed.status === 201, JSON.stringify(placed.json));
  const oid = placed.json.order_id;
  const mine = await api(cust, 'GET', '/orders/' + oid);
  check('server calculated the total (518 + 25 delivery + 5% tax)', mine.json.order?.total === 568.9, String(mine.json.order?.total));
  check('cart was emptied', (await api(cust, 'GET', '/cart')).json.lines?.length === 0);

  section('TEST 7  Admin receives the new order');
  check('order is in the admin list as "placed"', (await api(admin, 'GET', '/admin/orders?status=placed')).json.orders?.some((o) => o.id === oid));
  check('the delivery code is NOT sent to the admin', !('delivery_otp' in ((await api(admin, 'GET', '/admin/orders?status=placed')).json.orders?.find((o) => o.id === oid) || {})));

  section('TEST 8  Admin accepts and prepares the order');
  check('cannot skip straight to "ready"', (await api(admin, 'PATCH', `/admin/orders/${oid}/status`, { status: 'ready' })).status === 409);
  for (const s of ['accepted', 'preparing', 'ready']) check(`admin sets "${s}"`, (await api(admin, 'PATCH', `/admin/orders/${oid}/status`, { status: s })).status === 200);

  section('TEST 9-10  Riders receive the request; only ONE can claim it');
  await api(rider1, 'PATCH', '/delivery/availability', { availability: 'online' });
  check('rider 1 sees the request', (await api(rider1, 'GET', '/delivery/requests')).json.requests?.some((r) => r.id === oid));
  let rider2 = null;
  const r2email = `rider2+${stamp}@example.com`;
  const r2reg = await api(null, 'POST', '/auth/register', { name: 'E2E Rider Two', email: r2email, password: 'E2e-pass-123', phone: '9876543212', accountType: 'delivery', vehicleType: 'bike' });
  if (r2reg.status === 201) {
    rider2 = await login(r2email, 'E2e-pass-123');
    check('an unapproved rider is blocked', (await api(rider2, 'GET', '/delivery/dashboard')).status === 403);
    const pid = (await api(admin, 'GET', '/admin/partners')).json.partners?.find((p) => p.users?.email === r2email)?.id;
    await api(admin, 'PATCH', '/admin/partners/' + pid, { approval_status: 'approved' });
    await api(rider2, 'PATCH', '/delivery/availability', { availability: 'online' });
  }
  const contenders = [rider1, rider2].filter(Boolean);
  const results = await Promise.all(contenders.map((t) => api(t, 'POST', `/delivery/requests/${oid}/accept`)));
  const winners = results.map((r, i) => (r.status === 200 ? i : -1)).filter((i) => i >= 0);
  check(`exactly one rider wins the order (${contenders.length} tried)`, winners.length === 1, results.map((r) => r.status).join(','));
  const rider = contenders[winners[0]] || rider1;

  section('TEST 11  Customer sees the delivery status');
  const afterAssign = await api(cust, 'GET', '/orders/' + oid);
  check('status is "partner_assigned" and the partner is shown', afterAssign.json.order?.order_status === 'partner_assigned' && !!afterAssign.json.order?.delivery_partners?.users?.name);

  section('TEST 12  Rider completes the delivery with the customer code');
  const step = (s, otp) => api(rider, 'POST', '/delivery/active/step', { step: s, otp });
  check('cannot complete before arriving', (await step('complete', '1234')).status === 409);
  for (const s of ['arrived_restaurant', 'pickup', 'start_delivery', 'arrived_customer']) check(`rider step "${s}"`, (await step(s)).status === 200);
  const otp = afterAssign.json.order.delivery_otp;
  check('a wrong code is refused', (await step('complete', otp === '0000' ? '9999' : '0000')).status === 400);
  const done = await step('complete', otp);
  check('the right code completes the delivery', done.status === 200, JSON.stringify(done.json));

  section('TEST 13-15  Dashboards update and data persists');
  const stats = await api(admin, 'GET', '/admin/stats');
  check('admin completed orders >= 1', stats.json.counts?.completed >= 1);
  check('admin revenue > 0', stats.json.revenue?.total > 0);
  check('rider earnings > 0', (await api(rider, 'GET', '/delivery/earnings')).json.total > 0);
  const final = await api(cust, 'GET', '/orders/' + oid);
  check('order persisted as delivered and paid (cash collected)', final.json.order?.order_status === 'delivered' && final.json.order?.payment_status === 'paid');
  check('customer can now rate it', (await api(cust, 'POST', `/orders/${oid}/review`, { rating: 5, comment: 'e2e' })).status === 201);

  section('Security');
  check('no login -> 401', (await api(null, 'GET', '/orders')).status === 401);
  check('customer cannot open admin APIs', (await api(cust, 'GET', '/admin/stats')).status === 403);
  check('customer cannot open rider APIs', (await api(cust, 'GET', '/delivery/dashboard')).status === 403);
  check('rider cannot read customer orders', (await api(rider, 'GET', '/orders')).status === 403);
  check('another customer cannot read this order', (await api(await login('customer@example.com'), 'GET', '/orders/' + oid)).status === 404);

  await api(admin, 'PATCH', '/admin/restaurants/' + rid, { status: 'inactive' }); // tidy up
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('\nTest run stopped:', e.message); process.exit(1); });

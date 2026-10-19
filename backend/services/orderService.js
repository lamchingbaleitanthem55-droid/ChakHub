const supabase = require('../config/supabase');
const r2 = (n) => Math.round(n * 100) / 100;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const nowIST = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
function isOpen(open, close, now = nowIST()) {
  if (!open || !close) return true;
  const o = open.slice(0, 5), c = close.slice(0, 5);
  return o <= c ? now >= o && now < c : now >= o || now < c; // handles closing after midnight
}

async function getSettings() {
  const { data } = await supabase.from('settings').select('value').eq('key', 'app').maybeSingle();
  return { tax_percent: 5, min_order: 0, platform_commission_percent: 20, service_available: true, ...(data?.value || {}) };
}

async function loadCartItems(userId) {
  const { data } = await supabase.from('carts').select('items').eq('customer_id', userId).maybeSingle();
  return data?.items || [];
}

// Same dish + same options + same note = same cart line.
const lineKey = (i) => {
  const o = (i.options || []).map((x) => `${x.group}:${x.label}`).sort().join(',');
  const n = (i.note || '').trim();
  return !o && !n ? i.food_id : `${i.food_id}|${o}|${n}`;
};

// Checks the customer's option choices against what the dish really offers.
function resolveOptions(food, picked = []) {
  const groups = Array.isArray(food.customizations) ? food.customizations : [];
  const by = {};
  for (const p of picked) (by[p.group] ||= []).push(p.label);
  const chosen = []; let extra = 0;
  for (const g of groups) {
    const labels = [...new Set(by[g.name] || [])];
    delete by[g.name];
    if (g.type === 'one' && labels.length !== 1) return { ok: false };
    for (const label of labels) {
      const o = g.options.find((x) => x.label === label);
      if (!o) return { ok: false };
      chosen.push({ group: g.name, label, price: Number(o.price) }); extra += Number(o.price);
    }
  }
  return Object.keys(by).length ? { ok: false } : { ok: true, chosen, extra: r2(extra) };
}

// Prices come from the database, never from the browser.
async function priceItems(items) {
  const ids = [...new Set(items.map((i) => i.food_id))];
  const { data: foods, error } = ids.length ? await supabase.from('food_items').select('*').in('id', ids) : { data: [] };
  if (error) throw error;
  const map = new Map(foods.map((f) => [f.id, f]));
  const lines = [];
  for (const i of items) {
    const f = map.get(i.food_id);
    if (!f) continue;
    const r = resolveOptions(f, i.options || []);
    const base = r2(Number(f.price) * (1 - Number(f.discount_percent) / 100));
    const unit = r2(base + (r.ok ? r.extra : 0));
    lines.push({
      key: lineKey(i), food_id: f.id, restaurant_id: f.restaurant_id, name: f.name, image: f.image, is_veg: f.is_veg,
      price: unit, qty: i.qty, line_total: r2(unit * i.qty), available: !!f.availability && r.ok,
      options: r.ok ? r.chosen.map((c) => (c.price ? `${c.group}: ${c.label} (+₹${c.price})` : `${c.group}: ${c.label}`)) : [],
      selection: i.options || [], note: (i.note || '').trim().slice(0, 100),
    });
  }
  let restaurant = null;
  if (lines[0]) {
    const { data } = await supabase.from('restaurants').select('id,name,delivery_fee,status,opening_time,closing_time').eq('id', lines[0].restaurant_id).maybeSingle();
    if (data) restaurant = { ...data, delivery_fee: Number(data.delivery_fee), is_open: data.status === 'active' && isOpen(data.opening_time, data.closing_time) };
  }
  return { restaurant, lines, subtotal: r2(lines.reduce((s, l) => s + l.line_total, 0)) };
}

async function findCoupon(code) {
  const { data } = await supabase.from('coupons').select('*').eq('code', String(code).trim().toUpperCase()).maybeSingle();
  if (!data || !data.active) throw fail('That coupon code is not valid');
  return data;
}

function couponDiscount(c, subtotal, now = new Date()) {
  if (c.expiry_date && new Date(c.expiry_date) < now) throw fail('This coupon has expired');
  if (c.usage_limit != null && c.used_count >= c.usage_limit) throw fail('This coupon has been fully used');
  if (subtotal < Number(c.minimum_order)) throw fail(`Add items worth ₹${r2(Number(c.minimum_order) - subtotal)} more to use this coupon`);
  const v = Number(c.discount_value);
  return r2(c.discount_type === 'percent' ? subtotal * v / 100 : Math.min(v, subtotal));
}

function computeTotals({ subtotal, fee, taxPercent, discount = 0 }) {
  const taxes = r2(subtotal * taxPercent / 100);
  return { subtotal, delivery_fee: r2(fee), taxes, discount, total: r2(Math.max(0, subtotal - discount) + fee + taxes) };
}

module.exports = { r2, fail, isOpen, getSettings, loadCartItems, lineKey, resolveOptions, priceItems, findCoupon, couponDiscount, computeTotals };

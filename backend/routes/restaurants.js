const express = require('express');
const supabase = require('../config/supabase');
const router = express.Router();

// Current time in India as "HH:MM"
const nowIST = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());

function isOpen(open, close) {
  if (!open || !close) return true;
  const n = nowIST(), o = open.slice(0, 5), c = close.slice(0, 5);
  return o <= c ? n >= o && n < c : n >= o || n < c; // handles closing after midnight
}

function shape(r, foods) {
  const prices = foods.map((f) => Number(f.price));
  const best = Math.max(0, ...foods.map((f) => Number(f.discount_percent)));
  return {
    id: r.id, name: r.name, description: r.description, address: r.address, image: r.image,
    cuisine: r.cuisine, rating: Number(r.rating), delivery_fee: Number(r.delivery_fee),
    opening_time: r.opening_time?.slice(0, 5), closing_time: r.closing_time?.slice(0, 5),
    is_open: isOpen(r.opening_time, r.closing_time),
    pure_veg: foods.length > 0 && foods.every((f) => f.is_veg),
    avg_price: prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
    offer: best > 0 ? `${best}% off` : null,
    delivery_time: '30–40 min', // replaced by a distance-based estimate once locations are added
  };
}

// GET /api/restaurants?q=&category=&veg=1&minRating=4&maxFee=30&maxPrice=250&offers=1&sort=rating|fee|price
router.get('/', async (req, res, next) => {
  try {
    const [rs, fs] = await Promise.all([
      supabase.from('restaurants').select('*').eq('status', 'active'),
      supabase.from('food_items').select('restaurant_id,name,category,is_veg,price,discount_percent').eq('availability', true),
    ]);
    if (rs.error) throw rs.error;
    if (fs.error) throw fs.error;

    const byRest = {};
    fs.data.forEach((f) => (byRest[f.restaurant_id] ||= []).push(f));

    const { q = '', category = '', veg, minRating, maxFee, maxPrice, offers, sort } = req.query;
    const term = q.trim().toLowerCase().slice(0, 60);
    let out = rs.data.map((r) => {
      const foods = byRest[r.id] || [];
      const s = shape(r, foods);
      s.matched_dishes = term ? foods.filter((f) => f.name.toLowerCase().includes(term)).map((f) => f.name).slice(0, 3) : [];
      s._foods = foods;
      return s;
    });

    out = out.filter((r) => {
      if (term && !(r.name.toLowerCase().includes(term) || r.cuisine.some((c) => c.toLowerCase().includes(term)) || r.matched_dishes.length)) return false;
      if (category && !r._foods.some((f) => f.category.toLowerCase() === category.toLowerCase()) && !r.cuisine.some((c) => c.toLowerCase() === category.toLowerCase())) return false;
      if (veg === '1' && !r.pure_veg) return false;
      if (minRating && r.rating < Number(minRating)) return false;
      if (maxFee && r.delivery_fee > Number(maxFee)) return false;
      if (maxPrice && (r.avg_price ?? Infinity) > Number(maxPrice)) return false;
      if (offers === '1' && !r.offer) return false;
      return true;
    });

    const sorters = { rating: (a, b) => b.rating - a.rating, fee: (a, b) => a.delivery_fee - b.delivery_fee, price: (a, b) => (a.avg_price ?? 1e9) - (b.avg_price ?? 1e9) };
    out.sort((a, b) => (b.is_open - a.is_open) || (sorters[sort] || sorters.rating)(a, b));
    out.forEach((r) => delete r._foods);
    res.json({ restaurants: out });
  } catch (e) { next(e); }
});

router.get('/promos', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('coupons').select('code,discount_type,discount_value,minimum_order,expiry_date,usage_limit,used_count').eq('active', true);
    if (error) throw error;
    res.json({ promos: data.filter((c) => (!c.expiry_date || new Date(c.expiry_date) > new Date()) && (c.usage_limit == null || c.used_count < c.usage_limit))
      .map(({ usage_limit, used_count, ...p }) => p) });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Restaurant not found' });
    const { data: r, error } = await supabase.from('restaurants').select('*').eq('id', req.params.id).eq('status', 'active').maybeSingle();
    if (error) throw error;
    if (!r) return res.status(404).json({ error: 'Restaurant not found' });
    const { data: foods, error: fe } = await supabase.from('food_items').select('*').eq('restaurant_id', r.id).order('category').order('name');
    if (fe) throw fe;
    const rv = await supabase.from('reviews').select('rating,comment,created_at,users(name)').eq('restaurant_id', r.id).order('created_at', { ascending: false }).limit(10);
    const reviews = (rv.data || []).map((x) => ({ rating: x.rating, comment: x.comment, created_at: x.created_at, name: (x.users?.name || 'Customer').split(' ')[0] }));
    res.json({
      reviews,
      restaurant: shape(r, foods.filter((f) => f.availability)),
      menu: foods.map((f) => ({ id: f.id, name: f.name, description: f.description, price: Number(f.price), category: f.category,
        image: f.image, is_veg: f.is_veg, available: f.availability, discount_percent: Number(f.discount_percent), customizations: f.customizations })),
    });
  } catch (e) { next(e); }
});

module.exports = router;

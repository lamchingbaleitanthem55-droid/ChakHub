require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const supabase = require('./config/supabase');

const app = express();
app.set('trust proxy', 1); // behind Render/Heroku/Nginx, so rate limits see the real visitor IP
const supabaseOrigin = process.env.SUPABASE_URL || '';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      ...(process.env.NODE_ENV === 'production' ? {} : { 'upgrade-insecure-requests': null }),
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net', 'https://cdnjs.cloudflare.com', 'https://checkout.razorpay.com'],
      frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", supabaseOrigin, supabaseOrigin.replace('https://', 'wss://'), 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
    },
  },
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN ? process.env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()) : false })); // same-origin unless you set ALLOWED_ORIGIN

// The webhook needs the raw request body to check its signature, so it comes BEFORE the JSON parser.
app.use('/api/payments/webhook', require('./routes/webhook'));

app.use(express.json({ limit: '100kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/register', rateLimit({ windowMs: 15 * 60_000, limit: 10, message: { error: 'Too many sign-up attempts. Try again later.' } }));

// Public config. The anon key is designed to be public; the service key never leaves the server.
app.get('/api/config', async (req, res) => {
  let pub = {};
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'app').maybeSingle();
    const v = data?.value || {};
    pub = { name: v.name || 'Zestly', logo_url: v.logo_url || '', support_phone: v.support_phone || '' };
  } catch { /* defaults */ }
  res.json({
    supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    paymentsEnabled: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), ...pub,
  });
});
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/restaurants', require('./routes/restaurants'));
app.use('/api/cart', require('./routes/cart'));
app.use('/api/addresses', require('./routes/addresses'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/favorites', require('./routes/favorites'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/delivery', require('./routes/delivery'));
app.use('/api/notifications', require('./routes/notifications'));

const frontend = path.join(__dirname, '..', 'frontend');
['admin', 'delivery', 'customer'].forEach((p) => app.get('/' + p, (req, res, next) => res.sendFile(path.join(frontend, p + '.html'), (e) => e && next(e))));
app.use(express.static(frontend));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side' });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
}
module.exports = app;

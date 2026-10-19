const supabase = require('../config/supabase');

// Verifies the Supabase JWT and loads the profile + role from the database.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Login required' });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Session expired. Please log in again.' });

    const { data: profile } = await supabase
      .from('users').select('*').eq('id', data.user.id).maybeSingle();
    if (!profile) return res.status(403).json({ error: 'Profile not found' });
    if (profile.status !== 'active') return res.status(403).json({ error: 'Account is suspended' });

    req.user = profile;
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { requireAuth };

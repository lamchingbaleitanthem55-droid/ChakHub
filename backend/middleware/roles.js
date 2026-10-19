const supabase = require('../config/supabase');

// Role comes from the database, never from the client.
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Not allowed' });

// Delivery partners must also be approved by an admin.
async function requireApprovedPartner(req, res, next) {
  const { data } = await supabase
    .from('delivery_partners').select('id, approval_status').eq('user_id', req.user.id).maybeSingle();
  if (!data || data.approval_status !== 'approved')
    return res.status(403).json({ error: 'Your account is awaiting admin approval' });
  req.partner = data;
  next();
}

module.exports = { requireRole, requireApprovedPartner };

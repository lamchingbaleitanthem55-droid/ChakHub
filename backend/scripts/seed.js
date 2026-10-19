// Creates admin, customer and approved delivery partner test accounts.
const crypto = require('crypto');
const supabase = require('../config/supabase');

const password = process.env.SEED_PASSWORD || crypto.randomBytes(9).toString('base64url');
const accounts = [
  { name: 'Admin User', email: 'admin@example.com', phone: '9000000001', role: 'admin' },
  { name: 'Test Customer', email: 'customer@example.com', phone: '9000000002', role: 'customer' },
  { name: 'Test Rider', email: 'rider@example.com', phone: '9000000003', role: 'delivery' },
];

(async () => {
  for (const a of accounts) {
    let id;
    const { data, error } = await supabase.auth.admin.createUser({ email: a.email, password, email_confirm: true, user_metadata: { name: a.name } });
    if (error) {
      const list = await supabase.auth.admin.listUsers({ perPage: 1000 });
      id = list.data.users.find((u) => u.email === a.email)?.id;
      if (!id) { console.error(a.email, error.message); continue; }
      await supabase.auth.admin.updateUserById(id, { password });
    } else id = data.user.id;

    await supabase.from('users').upsert({ id, name: a.name, email: a.email, phone: a.phone, role: a.role });
    if (a.role === 'delivery')
      await supabase.from('delivery_partners').upsert({ user_id: id, vehicle_type: 'bike', approval_status: 'approved' }, { onConflict: 'user_id' });
    console.log('ready:', a.email, `(${a.role})`);
  }
  console.log('\nPassword for all test accounts:', password);
})();

const $ = (id) => document.getElementById(id);
const loginForm = $('login-form'), registerForm = $('register-form'), resetForm = $('reset-form');
const recovering = /type=recovery/.test(location.hash); // arrived from a password-reset email

// customer.html / admin.html / delivery.html are built in later phases.
const DESTINATIONS = { customer: '/customer.html', admin: '/admin.html', delivery: '/delivery.html' };

function showTab(name) {
  const login = name === 'login';
  loginForm.classList.toggle('hidden', !login);
  registerForm.classList.toggle('hidden', login);
  $('tab-login').setAttribute('aria-selected', login);
  $('tab-register').setAttribute('aria-selected', !login);
}
$('tab-login').onclick = () => showTab('login');
$('tab-register').onclick = () => showTab('register');
$('account-type').onchange = (e) => $('vehicle-wrap').classList.toggle('hidden', e.target.value !== 'delivery');

async function busy(form, fn) {
  const btn = form.querySelector('button[type=submit]'), label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Please wait…';
  try { await fn(); } catch (e) { App.toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = label; }
}

async function routeByRole() {
  const { user, partner } = await App.api('/auth/me');
  if (user.role === 'delivery' && partner?.approval_status !== 'approved') {
    await (await App.supabase()).auth.signOut();
    throw new Error('Your rider account is awaiting admin approval.');
  }
  location.href = DESTINATIONS[user.role];
}

loginForm.onsubmit = (e) => { e.preventDefault(); busy(loginForm, async () => {
  const f = new FormData(loginForm);
  const { error } = await (await App.supabase()).auth.signInWithPassword({ email: f.get('email').trim(), password: f.get('password') });
  if (error) throw new Error('Wrong email or password');
  await routeByRole();
}); };

registerForm.onsubmit = (e) => { e.preventDefault(); busy(registerForm, async () => {
  const body = Object.fromEntries(new FormData(registerForm));
  if (body.accountType !== 'delivery') delete body.vehicleType;
  const r = await App.api('/auth/register', { method: 'POST', body, auth: false });
  App.toast(r.message);
  registerForm.reset(); showTab('login');
}); };

$('forgot-btn').onclick = async () => {
  const email = loginForm.email.value.trim();
  if (!email) return App.toast('Enter your email above first', 'error');
  const { error } = await (await App.supabase()).auth.resetPasswordForEmail(email, { redirectTo: location.origin });
  error ? App.toast(error.message, 'error') : App.toast('Check your email for a reset link');
};

resetForm.onsubmit = (e) => { e.preventDefault(); busy(resetForm, async () => {
  const sb = await App.supabase();
  const { error } = await sb.auth.updateUser({ password: new FormData(resetForm).get('password') });
  if (error) throw new Error(error.message);
  await sb.auth.signOut(); history.replaceState(null, '', '/');
  resetForm.classList.add('hidden'); document.querySelector('.tabs').classList.remove('hidden'); showTab('login');
  App.toast('Password updated. Log in with your new password.');
}); };

// Already logged in? Skip the form.
(async () => {
  if (recovering) { document.querySelector('.tabs').classList.add('hidden'); loginForm.classList.add('hidden'); resetForm.classList.remove('hidden'); return; }
  try {
    const { data } = await (await App.supabase()).auth.getSession();
    if (data.session) await routeByRole();
  } catch (e) { if (e.message) App.toast(e.message, 'error'); }
})();

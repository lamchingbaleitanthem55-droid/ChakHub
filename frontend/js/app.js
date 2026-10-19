// Shared helpers: toast, API calls, Supabase client, offline banner.
const App = (() => {
  let client;

  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'status');
    el.textContent = message; // textContent: no XSS
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  async function supabase() {
    if (client) return client;
    const cfg = await (await fetch('/api/config')).json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('Server is missing Supabase configuration');
    client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    return client;
  }

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const { data } = await (await supabase()).auth.getSession();
      if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
    }
    const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Request failed');
    return json;
  }

  async function upload(path, file) { // sends one image file (admin only; the server re-checks its contents)
    if (file.size > 2 * 1024 * 1024) throw new Error('Images must be under 2 MB');
    const { data } = await (await supabase()).auth.getSession();
    const res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${data.session?.access_token}` }, body: file });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Upload failed');
    return json;
  }

  // Leaflet + OpenStreetMap, loaded only when a map is needed.
  let lf = null;
  const leaflet = () => lf ||= new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.onload = () => res(window.L); s.onerror = () => { lf = null; rej(new Error('Map failed to load')); }; document.head.appendChild(s);
  });
  const tiles = (L) => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
  const pin = (L, ll, color, label) => L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 }).bindTooltip(label);

  // Subscribes to database change signals. If realtime isn't available the pages fall back to slow polling.
  async function live(name, specs, onChange) {
    try {
      const sb = await supabase();
      let ch = sb.channel(name), connected = false;
      specs.forEach((s) => { ch = ch.on('postgres_changes', { event: s.event || '*', schema: 'public', table: s.table, ...(s.filter ? { filter: s.filter } : {}) }, (p) => onChange(s.table, p)); });
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') { if (connected) onChange('resync', {}); connected = true; } // re-sync after a dropped connection
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.warn('Live updates unavailable (' + status + '); using periodic refresh');
      });
      return ch;
    } catch (e) { console.warn('Live updates unavailable', e); }
  }

  const setOffline = () => document.getElementById('offline')?.classList.toggle('hidden', navigator.onLine);
  addEventListener('online', setOffline);
  addEventListener('offline', setOffline);
  setOffline();

  return { toast, supabase, api, upload, live, leaflet, tiles, pin };
})();

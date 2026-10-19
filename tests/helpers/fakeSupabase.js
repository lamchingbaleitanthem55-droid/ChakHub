// A tiny in-memory stand-in for the database so pricing logic can be tested without a network.
function chain(rows) {
  let r = rows;
  const api = {
    select: () => api, order: () => api, limit: () => api,
    in: (c, v) => { r = r.filter((x) => v.includes(x[c])); return api; },
    eq: (c, v) => { r = r.filter((x) => x[c] === v); return api; },
    maybeSingle: () => Promise.resolve({ data: r[0] || null, error: null }),
    single: () => Promise.resolve({ data: r[0] || null, error: null }),
    then: (res, rej) => Promise.resolve({ data: r, error: null }).then(res, rej),
  };
  return api;
}
function installFake(tables) {
  const p = require.resolve('../../backend/config/supabase');
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { from: (t) => chain(tables[t] || []) } };
}
module.exports = { installFake };

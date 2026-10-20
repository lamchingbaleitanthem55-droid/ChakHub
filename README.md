# Zestly: food delivery platform

A complete food delivery system with **three connected panels** (customer, admin, delivery partner) on one backend and one database, in the style of Zomato / Swiggy.

**Stack:** Node.js 22 + Express · Supabase (Postgres, Auth, Realtime, Storage) · plain HTML/CSS/JavaScript · Leaflet maps · Razorpay payments.

| Panel | URL | Who |
|---|---|---|
| Customer | `/customer.html` | browse, cart, checkout, track, reorder, rate |
| Admin | `/admin` | restaurants, dishes, orders, customers, riders, coupons, earnings, complaints, settings |
| Delivery partner | `/delivery` | go online, claim orders, deliver with a customer code, earnings |

---

## 1. Setup (about 15 minutes)

You need **Node.js 22 or newer** (nodejs.org, LTS) and a free **Supabase** project (supabase.com).

1. **Database.** In Supabase open *SQL Editor → New query* and run these files **in this order** (paste each file's contents, click Run):
   1. `database/schema.sql`
   2. `database/seed.sql` (sample restaurants and coupons)
   3. `database/phase6_realtime.sql` (instant updates)
   4. `database/phase7_payments.sql` (online payments)
   5. `database/phase8.sql` (image uploads)
   6. `database/phase9_zones.sql` (delivery zones)
   7. `database/phase10_zone_map.sql` (zone maps)
2. **Keys.** Copy `.env.example` to `.env` (create it as a *file* named `.env` in the project folder). Fill in the three Supabase values from *Project Settings → API*. The URL must end at `.supabase.co`.
3. **Install and seed.**
   ```
   npm install
   npm run seed
   ```
   The seed creates `admin@example.com`, `customer@example.com` and `rider@example.com` and prints their shared password. Save it.
4. **Run.** `npm start`, then open <http://localhost:3000>.

On Windows PowerShell, if `npm` is blocked: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## 2. Online payments (optional)

Without keys the app works with Cash on Delivery only.

1. Create a free account at razorpay.com, switch to **Test Mode**, and generate keys (*Account & Settings → API Keys*).
2. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`, restart.
3. Test with UPI ID `success@razorpay` (or `failure@razorpay`), or card `4111 1111 1111 1111`, any future date, any CVV.
4. **Recommended before going live:** add a webhook so a payment is never missed if a customer closes the tab. In Razorpay: *Webhooks → Add*, URL `https://YOUR-DOMAIN/api/payments/webhook`, events `payment.captured` and `order.paid`, then put the secret you choose in `RAZORPAY_WEBHOOK_SECRET`.

How payments stay safe: the server sets the amount from its own totals; a payment only counts after the server verifies Razorpay's signature **and** asks Razorpay's API that the exact payment was captured for the right amount; a payment ID can never be used on a second order; secrets never reach the browser.

## 3. Maps

Maps use **Leaflet** with **OpenStreetMap** tiles; no key is needed. Customers can pin their address, see their rider move, and admins see a live rider map. OpenStreetMap's free tile servers are meant for light use. For a busy production site, switch `App.tiles` in `frontend/js/app.js` to a paid tile provider.

## 4. Testing

```
npm test          # 17 unit tests: pricing, coupons, customisation, order rules, payment signatures, upload checks
npm run e2e       # full workflow against your running server and Supabase
```
For `e2e`: run `npm run seed`, start the server (`npm start`), put the seed password in `.env` as `E2E_PASSWORD`, then run `npm run e2e` in a second terminal. It walks the 15 required workflows (register → admin creates restaurant and dish → order → accept → rider claims (including a two-rider race) → OTP delivery → revenue and earnings update → data persists) plus security checks. It leaves one deactivated test restaurant behind.

## 5. Deploying

**Render (free tier, simplest).**
1. Put the project on GitHub (the included `.gitignore` keeps `.env` and `node_modules` out).
2. On render.com: *New → Blueprint*, choose the repo. `render.yaml` sets everything up.
3. Fill in the environment variables (the same values as your `.env`).
4. In Supabase: *Authentication → URL Configuration*, set **Site URL** to your Render URL and add it under **Redirect URLs** (needed for the password-reset email).
5. Switch Razorpay to Live keys only after completing their KYC and testing end to end.

**Docker / any host.** `docker build -t zestly .` then run with the same env vars and port 3000. Always serve over **HTTPS**: browsers only allow location sharing on secure pages (localhost counts as secure).

**Before real customers**
- Rotate your Supabase and Razorpay keys if they were ever pasted anywhere public.
- Run all five SQL files on the production Supabase project, then `npm run seed` once and **change the admin password** (or delete the seeded customer and rider accounts).
- Review *Authentication → Providers → Email* settings (email confirmation, rate limits) in Supabase.

## 6. Project layout

```
backend/
  server.js            app, security headers, rate limits, routes
  routes/              auth, restaurants, cart, addresses, orders, favorites, notifications, admin, delivery, webhook
  middleware/          auth (JWT), roles, validation (zod)
  services/            orderService (pricing), paymentService (Razorpay), settlement, orderFlow, imageCheck
  scripts/seed.js      creates the test accounts
frontend/              index.html (login), customer.html, admin.html, delivery.html, css/, js/
database/              schema.sql, seed.sql, phase6/7/8 migrations
tests/                 unit/ and e2e.js
```

## 7. Security summary

- Roles come from the database, never from the browser. Admin and rider APIs re-check the role on every call; riders must also be admin-approved.
- Prices, fees, tax, coupons and totals are calculated on the server. Customisation choices are re-validated against the real menu.
- Payments are verified server-side (above). Delivery needs the customer's 4-digit code; five wrong tries lock that order for 15 minutes.
- An order is claimed with one atomic database update, so two riders can never take the same order.
- Orders, addresses and cart are readable only by their owner. Row Level Security is on for every table; browsers only get "something changed" signals from realtime.
- Inputs validated with zod, output escaped (XSS), uploads checked by content and size, strict Content-Security-Policy, rate limiting, `Cache-Control: no-store` on API responses.

## 8. Known limits

- **Phone-number login** isn't included: it needs an SMS provider configured in Supabase.
- **Browser alerts** work while a tab is open. Alerts with everything closed need Web Push (extra keys and a service worker).
- **ETA and distance** are straight-line estimates at about 20 km/h, not road routing.
- **Rider "Decline"** hides a request on that device for the session; it is not recorded on the server.
- Wrong-code lockouts reset when the server restarts.
- Riders are added by self-signup plus admin approval (there is no "admin creates a rider" form).
- Dark mode follows the device setting; there is no manual toggle.

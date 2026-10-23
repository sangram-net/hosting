# GreenHost — full-stack hosting storefront starter

A responsive white/forest-green hosting storefront with website, VPS, backend and cloud plan categories; SQLite persistence; customer sign-up/sign-in; customer order dashboard; admin console; and Razorpay Checkout integration with server-side signature verification and webhook signature validation.

## Requirements
- Node.js 20+
- A Razorpay account and API keys for real payments (use test keys first)
- HTTPS and a production hosting environment for live deployment

## Run locally
```bash
cp .env.example .env
# Edit .env: set a long random JWT_SECRET and your admin credentials
npm install
npm start
```
Open http://localhost:3000.

The first run creates the SQLite database (`greenhost.db`) and a bootstrap administrator using `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Change these credentials before deployment. Do not commit `.env` or the database file.

## Razorpay setup
1. Create a Razorpay account and obtain **test** Key ID and Key Secret.
2. Put them in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
3. For webhook handling, configure `https://YOUR_DOMAIN/api/payments/webhook` in the Razorpay dashboard, subscribe to `payment.captured`, and set the matching webhook secret as `RAZORPAY_WEBHOOK_SECRET`.
4. Test the full checkout and webhook path before switching to live keys. Keep all secrets server-side.

The frontend intentionally shows checkout as unavailable until Razorpay keys are configured. The backend verifies the checkout signature and never trusts a browser-only “paid” flag.

## Main routes
- `GET /api/plans` — active plans
- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/orders` — creates local order and Razorpay order
- `POST /api/payments/verify` — server-side signature verification
- `POST /api/payments/webhook` — raw-body webhook signature verification
- `GET /api/orders` — signed-in customer's orders
- `GET /api/admin/summary`, `/api/admin/orders`, `/api/admin/users`
- `PATCH /api/admin/orders/:id/status` — admin-only status change

## Hosting provisioning note
This project tracks orders and allows an admin to mark the lifecycle status. It does **not** provision real websites, VPS instances, databases, DNS, SSL certificates or backend runtimes by itself. To sell actual hosting, connect a provider's API/control panel (for example a VPS/cloud provider or hosting control panel), implement provisioning and cancellation flows, and only mark services `active` after the provider confirms success. Plan resource descriptions in this starter are illustrative until you have confirmed infrastructure capacity and provider pricing.

## Before production
- Set `NODE_ENV=production`, a random `JWT_SECRET` of 32+ characters, strong admin credentials, and HTTPS.
- Add CSRF protection/origin checks for cookie-authenticated state-changing routes; add email verification, password reset, account lockout, audit logs and support flows.
- Add automated tests, database backups, monitoring and migrations.
- Review tax invoicing, refund/cancellation policy, privacy policy, terms of service and applicable Indian payment/business requirements.
- Configure a restrictive Content Security Policy and self-host fonts if you need a fully self-contained deployment.
- SQLite is suitable for a small demo; use PostgreSQL and a migration tool for a growing production service.

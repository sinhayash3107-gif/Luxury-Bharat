# Luxury Bharat — premium ecommerce platform

Storefront, CMS, section builder, admin dashboard, orders, inventory, support tickets and analytics, backed by a real database.
**Stack:** Node.js ≥ 22.13 (no framework), built-in SQLite (`node:sqlite`), vanilla ES-module frontend. The only optional dependency is `sharp` (image resize/WebP).

> This is **not** the Next.js + Prisma + PostgreSQL stack suggested in the brief. It was built and tested in an environment without network access, so a zero-dependency stack was the only way to run and verify everything. See "Moving to PostgreSQL / Vercel" below.

## Run it locally

```bash
npm install            # installs optional `sharp` for image optimisation
cp .env.example .env   # then edit
npm run seed:demo      # optional: demo catalogue (generated placeholder art, not photography)
npm start              # http://localhost:3000   (dashboard: /admin)
npm test               # 18 end-to-end API/security tests
```

## Owner account (one-time setup)
1. Start the server. If no owner exists it prints a **one-time setup token** (or uses `OWNER_SETUP_TOKEN`).
2. Open `/admin` → "First-time owner setup". The email must equal `OWNER_EMAIL` (`luxurybhaarat@gmail.com`). Choose a password (10+ chars, letters and numbers).
3. After that the endpoint returns 404 forever. The database itself forbids a second owner or demoting/deleting the owner (triggers + unique index). No password is hard-coded anywhere.

## Admin accounts (owner-controlled)
- Authorised addresses come from `ADMIN_EMAILS` (default `sinhayash3107@gmail.com,20dhruv08@gmail.com`).
- Owner → Dashboard → **Admin Accounts → Invite admin**, pick the address and permissions. The person receives a single-use, 7-day link, sets their own password, and only then becomes an admin.
- **Registering with a listed email never grants admin rights.** Owner → *Roles & Permissions* edits permissions live; removing an admin signs them out immediately.
- Admins can never: invite/remove admins, edit the owner, open Website Settings, Security Settings, or Audit Logs. Enforced in the server (`requireOwner` / `requirePerm`), not just hidden in the UI.

## Configuration (`.env`)
| Variable | Purpose |
|---|---|
| `NODE_ENV`, `PORT`, `APP_URL` | `production` enables Secure cookies + HSTS and disables test payments and the dev outbox. `APP_URL` is used in email links. |
| `DATA_DIR` | SQLite file + uploaded images. **Mount a persistent disk here.** |
| `TRUST_PROXY=1` | Only behind your own reverse proxy (real client IPs for rate limits). |
| `OWNER_EMAIL`, `ADMIN_EMAILS`, `OWNER_SETUP_TOKEN` | See above. |
| `RESEND_API_KEY`, `MAIL_FROM` | Email via [Resend](https://resend.com). Without a key, emails are stored in `email_log` and printed to the console. |
| `DEV_OUTBOX_ENABLED=1` | Optional local-only email preview at `/api/dev/outbox`. Disabled by default, requires owner sign-in, and unavailable in production. |
| `PAYMENT_MODE` | `test` = clearly labelled fake payment (development only). `live` = Razorpay. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay credentials. Server-side only. |

Cash on delivery is **off** until the owner enables it in Website Settings. Coupons can be created in the dashboard but are inactive until switched on.

## Images
Uploads are validated by magic bytes (JPEG/PNG/WebP/GIF only — SVG is refused), limited to 8 MB, auto-rotated, resized to ≤1600 px, converted to WebP and given a 480 px thumbnail (needs `sharp`). They are stored on local disk behind `storage.put/remove` in `server/lib/images.js`; swap those two functions to use S3/Cloudinary.

## Deployment
Needs a host with a **persistent disk** and a long-running Node process (Railway, Render, Fly.io, a VPS). Put it behind HTTPS (Caddy/Nginx/platform TLS), set `NODE_ENV=production`, `APP_URL=https://…`, `TRUST_PROXY=1`, mount `DATA_DIR`, and back up `DATA_DIR` regularly. Single instance only (SQLite + in-memory rate limits/SSE).

### Moving to PostgreSQL / Vercel
Vercel's serverless runtime can't hold a SQLite file or the SSE connections. To run there, port `server/lib/db.js` + the SQL in `server/routes/*` to Postgres (the schema in `server/migrations/001_init.sql` is portable; money is integer paise) and move uploads to object storage. This has **not** been done.

## Security checklist (what is implemented)
scrypt password hashing with per-user salt · HttpOnly + SameSite=Lax session cookies (Secure in production), hashed session tokens, expiry · CSRF token on every state-changing request + Origin check · mandatory email verification before ordering · single-use, hashed verify/reset/invite tokens · reset revokes all sessions · per-IP and per-account rate limits + account lockout (configurable) · generic responses on forgot-password · server-side validation of every field, price, stock and address · parameterised SQL only · output escaping in the UI (templating escapes by default), links restricted to `/…` or `https://` · CSP, nosniff, frame-ancestors, Referrer-Policy, Permissions-Policy, HSTS · upload sniffing + size limits · RBAC on the server, owner immutability in the database · audit log of admin actions · stock changes only via atomic SQL guarded by `stock >= qty` · unpaid online orders auto-cancel after 30 min and return stock.

## Tests that were run
- `npm test`: 18 end-to-end tests (real server, temp DB) — owner setup, RBAC, invites, uploads, products, search, checkout validation, price tampering, concurrent overselling (6 buyers / 3 units → exactly 3 orders), cancellation restoring stock once, notification + email de-duplication, analytics rules, section builder, tickets, CSRF, lockout, reset, SQL-injection probe, path traversal.
- Browser run (Chromium via Playwright): 29 checks of the real UI (register → verify → search → cart → 5-step checkout → test payment → live "NEW ORDER RECEIVED" alert in the owner's dashboard → status update → customer timeline; section builder create/preview/publish/hide; product creation with image upload; mobile layout) plus a smoke test of every admin and account screen. No JavaScript errors.

# Joe's Garage — Calgary's Shipping Container Bike Shop

> Expert bicycle repairs, quality rentals, and honest advice from a steel shipping container on the Bow River pathway. Since 2007.

**Live site:** [joes-garage.ca](https://joes-garage.ca)

---

## Quick Start

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 10.0.0
- **Docker** (for PostgreSQL)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Set up environment

```bash
cp .env.example .env
# Edit .env with your credentials (defaults work for local dev)
```

### 3. Start everything

```bash
# Start PostgreSQL + all three services in parallel:
pnpm dev

# Or start services individually:
docker compose up -d postgres    # Database
pnpm dev:cms                     # Payload CMS admin panel
pnpm dev:api                     # Booking API
pnpm dev:frontend                # Astro frontend
```

### 4. Open in browser

| Service | URL | Purpose |
|---------|-----|---------|
| **Frontend** | [localhost:4321](http://localhost:4321) | Public-facing website |
| **CMS Admin** | [localhost:3003/admin](http://localhost:3003/admin) | Content management |
| **API Health** | [localhost:3001/api/health](http://localhost:3001/api/health) | Booking API status |

### 5. Log into the CMS

- **Email:** `joshhunterduvar@gmail.com`
- **Password:** (set during first-run setup)

---

## Architecture

```
joes-garage/
├── packages/
│   ├── frontend/     Astro 5 — Static site with Tailwind v4 & Alpine.js
│   ├── cms/          Payload CMS 3.x — Content management (Next.js)
│   └── api/          Express 5 — Booking system, payments, waivers
├── docker-compose.yml    PostgreSQL 16 for local dev
├── .env                  Shared environment variables
└── CLAUDE.md             AI assistant instructions
```

### Data Flow

```
                    Build Time                          Runtime
                    ─────────                           ───────
Payload CMS ──→ Astro fetches content ──→ Static HTML   Alpine.js booking flow
(port 3003)     at build time              (port 4321)  ↓
                                                        Express API (port 3001)
                                                        ├── /api/availability
                                                        ├── /api/bookings
                                                        └── /api/waivers
                                                        ↓
                                                        PostgreSQL (port 5434)
```

---

## Port Assignments

| Port | Service | Notes |
|------|---------|-------|
| **3000** | node-social | **DO NOT TOUCH** — public-facing, separate project |
| **3001** | Express API | Booking system, payments, waivers |
| **3003** | Payload CMS | Admin panel (Next.js) |
| **4321** | Astro Frontend | Dev server |
| **5434** | PostgreSQL | Docker container, mapped from 5432 |

> **Warning:** Port 3000 is occupied by node-social. Never reassign any service to port 3000.

---

## Frontend (`packages/frontend/`)

Built with **Astro 5**, **Tailwind CSS v4**, and **Alpine.js**.

### Pages

| Page | Route | Description |
|------|-------|-------------|
| Home | `/` | Hero, services overview, booking steps, testimonials, CTA |
| About | `/about` | Joe's story, timeline, values |
| Services | `/services` | Repair & maintenance catalog with pricing |
| Book | `/book` | Multi-step booking flow (dates → bike → waiver → payment) |
| Confirmation | `/book/confirmation` | Post-booking confirmation with details |
| Contact | `/contact` | Contact form, hours, Google Maps embed |
| Gallery | `/gallery` | Photo grid (CMS-managed) |
| Dynamic Pages | `/[slug]` | CMS-composed pages via block system |

### Brand System

| Token | Value | Usage |
|-------|-------|-------|
| `red` | `#D42B2B` | Primary brand color, CTAs, accents |
| `coal` | `#1a1a1a` | Dark backgrounds, text |
| `cream` | `#FAF7F2` | Light backgrounds |
| `copper` | `#B87333` | Secondary accent |
| `amber` | `#D4A574` | Warm highlights |

### Key Files

- `src/styles/global.css` — Tailwind v4 theme, custom properties, animations
- `src/layouts/Base.astro` — HTML wrapper, nav, footer, SEO, schema.org
- `src/alpine.ts` — Booking flow state machine, API integration
- `src/lib/payload.ts` — CMS data fetching helpers

---

## CMS (`packages/cms/`)

Built with **Payload CMS 3.x** on **Next.js 15**.

### Collections

| Collection | Purpose |
|------------|---------|
| **Users** | Admin authentication |
| **Pages** | Dynamic pages with composable block layouts |
| **Bikes** | Rental inventory (type, size, price, status, features) |
| **Services** | Repair service catalog |
| **Testimonials** | Customer reviews |
| **Media** | Image uploads |

### Globals

| Global | Purpose |
|--------|---------|
| **Site Settings** | Shop name, logo, address, phone, hours, social links, waiver text |

### Block System

Pages are composed from reusable blocks: `Hero`, `TextBlock`, `Gallery`, `SideBySide`, `Testimonials`, `CTA`.

### Admin Customization

- Custom dark theme (`DarkThemeProvider.tsx`)
- Joe's Garage branding (logo, colors, fonts)
- All styles in `src/app/(payload)/custom.scss`

> **Important:** See `CLAUDE.md` for the Payload CSS packaging bug workaround. Do not remove the `@import` or `@layer` blocks in `custom.scss`.

---

## API (`packages/api/`)

Built with **Express 5**, **Zod** validation, **Moneris** payments.

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Health check + DB connection test |
| GET | `/api/availability?start=&end=` | Available bikes for date range |
| POST | `/api/bookings/hold` | Create 15-min hold on bike |
| POST | `/api/bookings/pay` | Process payment, confirm booking |
| GET | `/api/bookings/:id` | Booking confirmation details |
| POST | `/api/waivers` | Submit signed waiver + generate PDF |

### Admin Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/bookings/admin/list` | All non-cancelled bookings |
| POST | `/api/bookings/:id/capture` | Capture pre-authorized payment |
| POST | `/api/bookings/:id/void` | Void pre-authorization |
| POST | `/api/bookings/:id/complete` | Mark rental as returned |
| GET | `/api/bookings/:id/waiver` | Download signed waiver PDF |

### Security

- Helmet for HTTP headers
- CORS restricted to frontend origin
- Rate limiting (100 req/min global, 10 req/min for bookings)
- Zod schema validation on all inputs
- No stack traces leaked to clients

---

## Database

**PostgreSQL 16** via Docker.

```bash
# Connection string (local dev)
postgresql://postgres:postgres@localhost:5434/joes_garage

# Run migrations
pnpm --filter api migrate
```

### Schema

- `bookings.reservations` — Rental bookings with date ranges, status, payment info
- `bookings.customers` — Customer contact details
- `bookings.waivers` — Signed waivers with S3 PDF references
- Payload-managed tables for CMS content

---

## Environment Variables

See `.env.example` for all available configuration. Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | `postgresql://...localhost:5434/joes_garage` | PostgreSQL connection |
| `PAYLOAD_SECRET` | `dev-secret-...` | CMS encryption key |
| `PAYLOAD_URL` | `http://localhost:3003` | CMS API base URL |
| `PUBLIC_API_URL` | `http://localhost:3001` | Booking API base URL |
| `PORT` | `3001` | API server port |
| `CORS_ORIGINS` | `http://localhost:4321` | Allowed frontend origins |

### Optional (for full booking flow)

| Variable | Purpose |
|----------|---------|
| `MONERIS_STORE_ID` | Payment processing |
| `SMTP_HOST` | Email confirmations |
| `S3_ENDPOINT` | Waiver PDF storage |
| `CLOUDFLARE_DEPLOY_HOOK` | Auto-rebuild on CMS changes |

---

## Common Tasks

### Add a new page in the CMS

1. Go to [localhost:3003/admin/collections/pages](http://localhost:3003/admin/collections/pages)
2. Click "Create New"
3. Add a title and slug
4. Compose the page using available blocks (Hero, TextBlock, Gallery, etc.)
5. Publish — the frontend auto-rebuilds if the Cloudflare webhook is configured

### Add a new bike to the rental fleet

1. Go to [localhost:3003/admin/collections/bikes](http://localhost:3003/admin/collections/bikes)
2. Click "Create New"
3. Fill in name, type, size, price/day, deposit, photo, features
4. Set status to "available"

### Test the booking flow locally

1. Ensure all three services are running
2. Go to [localhost:4321/book](http://localhost:4321/book)
3. Select dates, choose a bike, sign the waiver
4. Payment requires Moneris sandbox credentials in `.env`

---

## Deployment

- **Frontend:** Cloudflare Pages (Astro adapter configured)
- **CMS + API:** Docker Compose (see `docker-compose.prod.yml`)
- **Database:** PostgreSQL 16

```bash
# Build all packages
pnpm build

# Build individually
pnpm build:frontend
pnpm build:cms
pnpm build:api
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Astro 5, Tailwind CSS v4, Alpine.js |
| CMS | Payload CMS 3.x, Next.js 15, React 19 |
| API | Express 5, Zod, Moneris |
| Database | PostgreSQL 16 |
| Hosting | Cloudflare Pages (frontend), Docker (CMS/API) |
| Storage | Hetzner S3 (waiver PDFs) |
| Fonts | Jost (body), Franchise (display headings) |

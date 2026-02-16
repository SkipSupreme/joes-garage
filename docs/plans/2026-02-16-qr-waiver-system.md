# QR Walk-Up Waiver System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let customers sign rental waivers by scanning a permanent QR code at the shop (or a shared link) — no booking needed — then let Joe link those waivers to walk-in bookings from the admin panel.

**Architecture:** Add a public `/waiver` page (no booking ref required) that creates "unlinked" waivers (`reservation_id = NULL`). Add admin API endpoints to list today's unlinked waivers and link them to bookings. Enhance the walk-in modal to show and link pre-signed waivers. Add a "waivers ready" counter to the dashboard.

**Tech Stack:** Astro (frontend page), Alpine.js (client-side logic), Express (API endpoints), React (admin components), PostgreSQL (schema migration)

---

## Task 1: Database Migration — Make waivers.reservation_id Nullable

**Files:**
- Create: `packages/api/src/db/migrations/003-nullable-waiver-reservation.sql`
- Run against: PostgreSQL at `postgresql://postgres:postgres@localhost:5434/joes_garage`

**Step 1: Write the migration SQL**

```sql
-- Migration 003: Allow standalone waivers (no reservation required)
-- Enables the QR walk-up waiver flow where customers sign before a booking exists.

ALTER TABLE bookings.waivers
  ALTER COLUMN reservation_id DROP NOT NULL;

-- Index for efficiently querying today's unlinked waivers
CREATE INDEX idx_waivers_unlinked
  ON bookings.waivers (signed_at DESC)
  WHERE reservation_id IS NULL;
```

**Step 2: Run the migration**

```bash
cd packages/api
psql "postgresql://postgres:postgres@localhost:5434/joes_garage" -f src/db/migrations/003-nullable-waiver-reservation.sql
```

Expected: `ALTER TABLE` + `CREATE INDEX` — no errors.

**Step 3: Verify**

```bash
psql "postgresql://postgres:postgres@localhost:5434/joes_garage" -c "\d bookings.waivers" | grep reservation_id
```

Expected: `reservation_id | uuid | |` (no `not null` constraint).

**Step 4: Commit**

```bash
git add packages/api/src/db/migrations/003-nullable-waiver-reservation.sql
git commit -m "feat: allow standalone waivers with nullable reservation_id"
```

---

## Task 2: API — Standalone Waiver Submission Endpoint

**Files:**
- Modify: `packages/api/src/routes/waivers.ts`
- Reference: `packages/api/src/services/waiver-pdf.ts` (WaiverData interface, `reservationId` field)
- Reference: `packages/api/src/services/cms.ts` (getWaiverTextFromCMS)
- Reference: `packages/api/src/services/storage.ts` (uploadWaiverPdf)

**Context:** The existing `POST /api/waivers` requires `reservationId` (UUID) and verifies the reservation exists. The new endpoint skips reservation verification and creates an unlinked waiver.

**Step 1: Add the standalone waiver schema and endpoint**

Add to `packages/api/src/routes/waivers.ts` after the existing `POST /` handler:

```typescript
const standaloneWaiverSchema = z.object({
  signatureDataUrl: z
    .string()
    .startsWith('data:image/png;base64,')
    .max(MAX_SIGNATURE_LENGTH, 'Signature data too large'),
  fullName: z.string().min(2).max(200).trim(),
  email: z.string().email().max(254).trim().toLowerCase(),
  phone: z
    .string()
    .min(7)
    .max(20)
    .regex(/^[+\d\s()-]+$/, 'Invalid phone format'),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((dob) => {
      const date = new Date(dob);
      const now = new Date();
      return !isNaN(date.getTime()) && date < now;
    }, 'Invalid date of birth'),
  consentElectronic: z.literal(true),
  consentTerms: z.literal(true),
  isMinor: z.boolean().default(false),
  guardianName: z.string().min(2).max(200).trim().optional(),
});

/**
 * POST /api/waivers/standalone
 * Signs a waiver without a booking (QR walk-up flow).
 * Creates customer + waiver with reservation_id = NULL.
 */
waiversRouter.post('/standalone', async (req, res) => {
  const parsed = standaloneWaiverSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  const data = parsed.data;
  const signerIp = req.ip || req.socket.remoteAddress || 'unknown';
  const signerUa = (req.headers['user-agent'] || 'unknown').slice(0, 500);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create or update customer
    const customerResult = await client.query(
      `INSERT INTO bookings.customers (full_name, email, phone, date_of_birth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         phone = EXCLUDED.phone,
         date_of_birth = EXCLUDED.date_of_birth
       RETURNING id`,
      [data.fullName, data.email, data.phone, data.dateOfBirth],
    );
    const customerId = customerResult.rows[0].id;

    // Fetch waiver text from CMS
    const waiverText = await getWaiverTextFromCMS();

    // Generate waiver PDF (use 'standalone' as reservation context)
    const { pdfBuffer, sha256 } = await generateWaiverPdf({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      dateOfBirth: data.dateOfBirth,
      reservationId: 'standalone',
      signatureDataUrl: data.signatureDataUrl,
      signerIp,
      signerUa,
      waiverText: waiverText || undefined,
    });

    // Store PDF with unique key (no reservation ID)
    const storageKey = `waivers/standalone-${customerId}-${Date.now()}.pdf`;
    await uploadWaiverPdf(storageKey, pdfBuffer);

    // Insert waiver with NULL reservation_id
    const waiverResult = await client.query(
      `INSERT INTO bookings.waivers
        (reservation_id, customer_id, pdf_storage_key, pdf_sha256, signed_at, signer_ip, signer_ua, consent_electronic, consent_terms, is_minor, guardian_customer_id)
       VALUES (NULL, $1, $2, $3, NOW(), $4::inet, $5, $6, $7, $8, NULL)
       RETURNING id`,
      [
        customerId,
        storageKey,
        sha256,
        signerIp,
        signerUa,
        data.consentElectronic,
        data.consentTerms,
        data.isMinor,
      ],
    );

    await client.query('COMMIT');

    res.status(201).json({
      waiverId: waiverResult.rows[0].id,
      success: true,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Standalone waiver submission error:', err);
    res.status(500).json({ error: 'Failed to submit waiver' });
  } finally {
    client.release();
  }
});
```

**Step 2: Verify the API restarts and endpoint works**

```bash
# Restart API (uses tsx watch so should auto-reload)
curl -s -X POST http://localhost:3001/api/waivers/standalone \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

Expected: `400 Invalid request` (not 404 — proves the route exists).

**Step 3: Commit**

```bash
git add packages/api/src/routes/waivers.ts
git commit -m "feat: add standalone waiver endpoint for QR walk-up flow"
```

---

## Task 3: API — Admin Endpoints for Unlinked Waivers

**Files:**
- Modify: `packages/api/src/routes/admin.ts`

**Context:** The admin routes are in `packages/api/src/routes/admin.ts`. They use `adminRouter` (Express Router) with auth middleware already applied. All responses use `pool` from `../db/pool.js`.

**Step 1: Add GET /waivers/unlinked endpoint**

Add after the existing fleet endpoint (around line 930) in `packages/api/src/routes/admin.ts`:

```typescript
// ── 11. GET /waivers/unlinked ──────────────────────────────────────────────

adminRouter.get('/waivers/unlinked', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        w.id AS waiver_id,
        c.full_name,
        c.email,
        c.phone,
        w.signed_at,
        w.is_minor
      FROM bookings.waivers w
      JOIN bookings.customers c ON w.customer_id = c.id
      WHERE w.reservation_id IS NULL
        AND w.signed_at::date = CURRENT_DATE
      ORDER BY w.signed_at DESC
    `);

    res.json({ waivers: result.rows });
  } catch (err) {
    console.error('Unlinked waivers error:', err);
    res.status(500).json({ error: 'Failed to fetch unlinked waivers' });
  }
});
```

**Step 2: Add PATCH /bookings/:id/link-waivers endpoint**

Add after the new GET endpoint:

```typescript
// ── 12. PATCH /bookings/:id/link-waivers ───────────────────────────────────

const linkWaiversSchema = z.object({
  waiverIds: z.array(z.string().uuid()).min(1).max(20),
});

adminRouter.patch('/bookings/:id/link-waivers', async (req, res) => {
  const idParsed = uuidParam.safeParse(req.params.id);
  if (!idParsed.success) {
    res.status(400).json({ error: 'Invalid booking ID' });
    return;
  }
  const parsed = linkWaiversSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }

  const reservationId = idParsed.data;
  const { waiverIds } = parsed.data;

  try {
    // Verify reservation exists
    const resCheck = await pool.query(
      `SELECT id FROM bookings.reservations WHERE id = $1`,
      [reservationId],
    );
    if (resCheck.rowCount === 0) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }

    // Link waivers: only update waivers that are currently unlinked
    const updateResult = await pool.query(
      `UPDATE bookings.waivers
       SET reservation_id = $1
       WHERE id = ANY($2)
         AND reservation_id IS NULL
       RETURNING id`,
      [reservationId, waiverIds],
    );

    // Also link the first waiver's customer to the reservation if it has no customer
    if (updateResult.rowCount && updateResult.rowCount > 0) {
      const firstWaiver = await pool.query(
        `SELECT customer_id FROM bookings.waivers WHERE id = $1`,
        [updateResult.rows[0].id],
      );
      if (firstWaiver.rows[0]?.customer_id) {
        await pool.query(
          `UPDATE bookings.reservations
           SET customer_id = COALESCE(customer_id, $2), updated_at = NOW()
           WHERE id = $1`,
          [reservationId, firstWaiver.rows[0].customer_id],
        );
      }
    }

    res.json({
      linked: updateResult.rowCount || 0,
      message: `${updateResult.rowCount || 0} waiver(s) linked to booking`,
    });
  } catch (err) {
    console.error('Link waivers error:', err);
    res.status(500).json({ error: 'Failed to link waivers' });
  }
});
```

**Step 3: Add unlinked waiver count to dashboard stats**

Modify the existing `GET /dashboard` endpoint (around line 60-95) to add the unlinked waiver count. Add this query inside the try block, after the existing stats query:

```typescript
    // Today's unlinked waivers count (for "waivers ready" badge)
    const unlinkedResult = await pool.query(`
      SELECT COUNT(*)::int AS count
      FROM bookings.waivers
      WHERE reservation_id IS NULL
        AND signed_at::date = CURRENT_DATE
    `);
```

Add to the response object (inside the `res.json({...})` call):

```typescript
    res.json({
      stats: {
        ...stats,
        waivers_ready: unlinkedResult.rows[0].count,
      },
      alerts: { ... },
    });
```

**Step 4: Verify both endpoints**

```bash
# Test unlinked waivers endpoint
curl -s http://localhost:3001/api/admin/waivers/unlinked \
  -H "Authorization: Bearer <admin-token>" | jq .

# Test dashboard now includes waivers_ready
curl -s http://localhost:3001/api/admin/dashboard \
  -H "Authorization: Bearer <admin-token>" | jq .stats.waivers_ready
```

**Step 5: Commit**

```bash
git add packages/api/src/routes/admin.ts
git commit -m "feat: admin endpoints for unlinked waivers (list, link, dashboard count)"
```

---

## Task 4: Frontend — Public Waiver Page (`/waiver`)

**Files:**
- Create: `packages/frontend/src/pages/waiver/index.astro`
- Modify: `packages/frontend/src/alpine.ts` (add `standaloneWaiver` Alpine component)

**Context:** The existing waiver page is at `/waiver/[ref].astro` (requires booking ref). The new page is at `/waiver/index.astro` (no ref needed). Both live in the same directory. The existing `waiverPage` Alpine component is at line ~430 in `alpine.ts`.

**Step 1: Create the Astro page**

Create `packages/frontend/src/pages/waiver/index.astro`. Model it after the existing `[ref].astro` but simpler — no booking details section, no waiver progress tracking. Just the sign form + waiver text sidebar.

Key differences from `[ref].astro`:
- No `fetchBooking()` call — there's no booking
- No "Booking Details" or "Waivers Signed" sections
- POST to `/api/waivers/standalone` instead of `/api/waivers`
- No `reservationId` in the body
- Success screen says "You're all set! Show Joe your name when ready to ride."
- "Sign another waiver" button resets the form (for next person in group)

The page should:
- Use `Base` layout (consistent header/footer)
- Import `getSiteSettings` to render CMS waiver text in sidebar
- Use `x-data="standaloneWaiver"` Alpine component
- Include signature_pad canvas
- Be mobile-first (customers scan QR on their phones)

**Step 2: Add the Alpine component**

Add to `packages/frontend/src/alpine.ts`, after the existing `waiverPage` component:

```typescript
Alpine.data('standaloneWaiver', () => ({
  loading: false,
  error: null as string | null,
  successMessage: null as string | null,
  submitting: false,
  signaturePad: null as any,

  waiver: {
    fullName: '',
    email: '',
    phone: '',
    dobMonth: '',
    dobDay: '',
    dobYear: '',
    isMinor: false,
    guardianName: '',
    consentElectronic: false,
    consentTerms: false,
  },

  // Same DOB helpers as waiverPage
  get dobMonths() { ... },   // Copy from waiverPage
  get dobDays() { ... },
  get dobYears() { ... },
  get dateOfBirth() { ... },

  init() {
    this.$nextTick(() => {
      const canvas = document.getElementById('waiver-signature-pad') as HTMLCanvasElement | null;
      if (canvas) {
        const ratio = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext('2d')!.scale(ratio, ratio);
        this.signaturePad = new SignaturePad(canvas, {
          backgroundColor: 'rgb(255, 255, 255)',
          penColor: 'rgb(30, 30, 30)',
        });
      }
    });
  },

  clearSignature() {
    if (this.signaturePad) this.signaturePad.clear();
  },

  resetForm() {
    this.waiver = {
      fullName: '', email: '', phone: '',
      dobMonth: '', dobDay: '', dobYear: '',
      isMinor: false, guardianName: '',
      consentElectronic: false, consentTerms: false,
    };
    this.successMessage = null;
    this.error = null;
    if (this.signaturePad) this.signaturePad.clear();
  },

  async submitWaiver() {
    this.error = null;
    this.successMessage = null;
    this.submitting = true;

    if (!this.signaturePad || this.signaturePad.isEmpty()) {
      this.error = 'Please draw your signature.';
      this.submitting = false;
      return;
    }

    try {
      const body: any = {
        signatureDataUrl: this.signaturePad.toDataURL('image/png'),
        fullName: this.waiver.fullName.trim(),
        email: this.waiver.email.trim(),
        phone: this.waiver.phone.trim(),
        dateOfBirth: this.dateOfBirth,
        consentElectronic: this.waiver.consentElectronic,
        consentTerms: this.waiver.consentTerms,
        isMinor: this.waiver.isMinor,
      };
      if (this.waiver.isMinor && this.waiver.guardianName.trim()) {
        body.guardianName = this.waiver.guardianName.trim();
      }

      const res = await fetch(`${API_URL}/api/waivers/standalone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit waiver.');

      this.successMessage = this.waiver.fullName.trim();
    } catch (err: any) {
      this.error = err.message;
    } finally {
      this.submitting = false;
    }
  },
}));
```

**Step 3: Build and verify**

```bash
cd packages/frontend && npx astro build
# Start dev server and navigate to http://localhost:4321/waiver
```

Expected: Public waiver page loads with form, signature pad, waiver text sidebar. No booking details shown.

**Step 4: Commit**

```bash
git add packages/frontend/src/pages/waiver/index.astro packages/frontend/src/alpine.ts
git commit -m "feat: public waiver page for QR walk-up signing"
```

---

## Task 5: Admin UI — "Waivers Ready" Badge on Dashboard

**Files:**
- Modify: `packages/cms/src/components/views/Bookings/useBookings.ts` (add `waivers_ready` to DashboardStats)
- Modify: `packages/cms/src/components/views/Bookings/BookingsClient.tsx` (pass count to header area)

**Context:** `DashboardStats` is defined in `useBookings.ts` line 47. The stats are fetched from `GET /api/admin/dashboard`. The "New Walk-in" button is in `BookingsClient.tsx` line 76.

**Step 1: Update DashboardStats interface**

In `useBookings.ts`, add to the `DashboardStats` interface:

```typescript
export interface DashboardStats {
  active_rentals: number
  returns_due_today: number
  overdue_count: number
  available_fleet: number
  total_fleet: number
  waivers_ready: number  // NEW
}
```

**Step 2: Show badge near walk-in button**

In `BookingsClient.tsx`, next to the "+ New Walk-in" button, add a "waivers ready" indicator when count > 0:

```tsx
{stats?.waivers_ready && stats.waivers_ready > 0 && (
  <span className="waivers-ready-badge">
    {stats.waivers_ready} waiver{stats.waivers_ready !== 1 ? 's' : ''} ready
  </span>
)}
```

**Step 3: Add CSS for the badge**

In `packages/cms/src/components/views/Bookings/bookings.scss`, add:

```scss
.waivers-ready-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(16, 185, 129, 0.12);
  color: #10B981;
  border: 1px solid rgba(16, 185, 129, 0.2);
}
```

**Step 4: Verify**

Navigate to `http://localhost:3003/admin/bookings`. If there are unlinked waivers from today, the badge should appear next to the walk-in button.

**Step 5: Commit**

```bash
git add packages/cms/src/components/views/Bookings/useBookings.ts \
       packages/cms/src/components/views/Bookings/BookingsClient.tsx \
       packages/cms/src/components/views/Bookings/bookings.scss
git commit -m "feat: 'waivers ready' badge on bookings dashboard"
```

---

## Task 6: Admin UI — Link Waivers in Walk-In Modal

**Files:**
- Modify: `packages/cms/src/components/views/Bookings/WalkInModal.tsx`

**Context:** The walk-in modal currently has 3 steps: (1) Select Bikes, (2) Customer Info, (3) Confirmation. After creating the walk-in, step 3 shows the booking ref and waiver URL. We'll add a waiver-linking section to step 3.

**Step 1: Fetch unlinked waivers on step 3**

After the walk-in is created successfully and `result` is set, fetch today's unlinked waivers:

```typescript
const [unlinkedWaivers, setUnlinkedWaivers] = useState<Array<{
  waiver_id: string
  full_name: string
  email: string
  phone: string
  signed_at: string
  is_minor: boolean
}>>([])
const [selectedWaivers, setSelectedWaivers] = useState<Set<string>>(new Set())
const [linking, setLinking] = useState(false)
const [linkMessage, setLinkMessage] = useState<string | null>(null)
```

Add a `useEffect` that fires when `result` changes:

```typescript
useEffect(() => {
  if (!result) return
  const fetchUnlinked = async () => {
    try {
      const res = await adminFetch(`${apiUrl}/api/admin/waivers/unlinked`)
      if (res.ok) {
        const data = await res.json()
        setUnlinkedWaivers(data.waivers || [])
      }
    } catch (err) {
      console.error('Failed to fetch unlinked waivers:', err)
    }
  }
  fetchUnlinked()
}, [result, apiUrl])
```

**Step 2: Add link handler**

```typescript
const handleLinkWaivers = async () => {
  if (selectedWaivers.size === 0 || !result) return
  setLinking(true)
  try {
    const res = await adminFetch(`${apiUrl}/api/admin/bookings/${result.reservationId}/link-waivers`, {
      method: 'PATCH',
      body: JSON.stringify({ waiverIds: Array.from(selectedWaivers) }),
    })
    if (!res.ok) throw new Error('Failed to link waivers')
    const data = await res.json()
    setLinkMessage(data.message)
    // Remove linked waivers from the list
    setUnlinkedWaivers((prev) => prev.filter((w) => !selectedWaivers.has(w.waiver_id)))
    setSelectedWaivers(new Set())
  } catch (err: any) {
    setError(err.message)
  } finally {
    setLinking(false)
  }
}
```

**Step 3: Render waiver list in step 3**

Add below the existing waiver URL section in step 3:

```tsx
{/* Link pre-signed waivers */}
{unlinkedWaivers.length > 0 && (
  <div className="walk-in-modal__link-waivers">
    <p className="walk-in-modal__label">Pre-Signed Waivers Available</p>
    <p className="walk-in-modal__waiver-hint">
      Select waivers signed today to link to this booking:
    </p>
    <div className="walk-in-modal__waiver-list">
      {unlinkedWaivers.map((w) => (
        <label key={w.waiver_id} className="walk-in-modal__waiver-item">
          <input
            type="checkbox"
            checked={selectedWaivers.has(w.waiver_id)}
            onChange={(e) => {
              setSelectedWaivers((prev) => {
                const next = new Set(prev)
                if (e.target.checked) next.add(w.waiver_id)
                else next.delete(w.waiver_id)
                return next
              })
            }}
          />
          <span className="walk-in-modal__waiver-name">{w.full_name}</span>
          <span className="walk-in-modal__waiver-time">
            {new Date(w.signed_at).toLocaleTimeString('en-CA', {
              timeZone: 'America/Edmonton',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
          {w.is_minor && <span className="walk-in-modal__waiver-minor">Minor</span>}
        </label>
      ))}
    </div>
    <button
      className="walk-in-modal__nav-btn walk-in-modal__nav-btn--primary"
      onClick={handleLinkWaivers}
      disabled={selectedWaivers.size === 0 || linking}
      type="button"
      style={{ marginTop: '8px' }}
    >
      {linking ? 'Linking...' : `Link ${selectedWaivers.size} Waiver${selectedWaivers.size !== 1 ? 's' : ''}`}
    </button>
    {linkMessage && <p className="walk-in-modal__link-success">{linkMessage}</p>}
  </div>
)}
```

**Step 4: Add CSS for waiver list**

In `bookings.scss`:

```scss
.walk-in-modal__link-waivers {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.walk-in-modal__waiver-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0;
}

.walk-in-modal__waiver-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  transition: background 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  input[type="checkbox"] {
    accent-color: #10B981;
  }
}

.walk-in-modal__waiver-name {
  font-weight: 500;
  flex: 1;
}

.walk-in-modal__waiver-time {
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
}

.walk-in-modal__waiver-minor {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(251, 191, 36, 0.15);
  color: #FCD34D;
}

.walk-in-modal__link-success {
  margin-top: 8px;
  font-size: 13px;
  color: #10B981;
}
```

**Step 5: Verify**

1. Sign a standalone waiver at `http://localhost:4321/waiver`
2. Open admin bookings → New Walk-in → create a walk-in
3. Step 3 should show the pre-signed waiver in a linkable list
4. Select and link it
5. Verify the booking detail now shows the linked waiver

**Step 6: Commit**

```bash
git add packages/cms/src/components/views/Bookings/WalkInModal.tsx \
       packages/cms/src/components/views/Bookings/bookings.scss
git commit -m "feat: link pre-signed waivers in walk-in modal"
```

---

## Task 7: Integration — Walk-In Waiver URL Token Fix

**Files:**
- Modify: `packages/api/src/routes/admin.ts` (walk-in endpoint response)
- Modify: `packages/api/src/routes/bookings.ts` (import generateBookingToken)

**Context:** The walk-in endpoint currently returns `waiverUrl: /waiver/${bookingRef}` without the HMAC token. The standalone waiver page at `/waiver/{ref}` now requires `?token=` for booking ref lookups (security audit fix). The walk-in response needs to include the token.

**Step 1: Fix walk-in response URL**

In `packages/api/src/routes/admin.ts`, import `generateBookingToken` at the top:

```typescript
import { generateBookingToken } from './bookings.js';
```

Update the walk-in success response (around line 879):

```typescript
const bookingToken = generateBookingToken(bookingRef);

res.status(201).json({
  reservationId,
  bookingRef,
  status: 'active',
  waiverUrl: `/waiver/${bookingRef}?token=${bookingToken}`,
  totalAmount: totalAmount.toFixed(2),
  returnTime: endTime.toISOString(),
});
```

**Step 2: Verify**

Create a new walk-in in admin. The waiver URL shown should include `?token=...`.

**Step 3: Commit**

```bash
git add packages/api/src/routes/admin.ts
git commit -m "fix: include HMAC token in walk-in waiver URL"
```

---

## Task 8: Final Polish — Add Waiver Link to Website Navigation

**Files:**
- Modify: `packages/frontend/src/pages/book/index.astro` (add "Sign waiver ahead of time" link)

**Context:** The booking page is the natural place to tell customers about pre-signing. Add a subtle note on the booking page encouraging groups to pre-sign.

**Step 1: Add pre-sign CTA**

On the booking page, near the top or in the cart area, add:

```html
<p class="text-sm text-ink-muted">
  Coming with a group?
  <a href="/waiver" class="text-red hover:underline">Sign your waivers ahead of time</a>
  to speed things up at the shop.
</p>
```

**Step 2: Build and verify**

```bash
cd packages/frontend && npx astro build
```

**Step 3: Commit**

```bash
git add packages/frontend/src/pages/book/index.astro
git commit -m "feat: add pre-sign waiver link on booking page"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | DB migration — nullable reservation_id | `migrations/003-...sql` |
| 2 | API — `POST /waivers/standalone` | `routes/waivers.ts` |
| 3 | API — admin endpoints (list unlinked, link waivers, dashboard count) | `routes/admin.ts` |
| 4 | Frontend — public `/waiver` page + Alpine component | `pages/waiver/index.astro`, `alpine.ts` |
| 5 | Admin UI — "waivers ready" badge | `useBookings.ts`, `BookingsClient.tsx`, `bookings.scss` |
| 6 | Admin UI — link waivers in walk-in modal | `WalkInModal.tsx`, `bookings.scss` |
| 7 | Fix — HMAC token in walk-in waiver URL | `routes/admin.ts` |
| 8 | Polish — pre-sign link on booking page | `book/index.astro` |

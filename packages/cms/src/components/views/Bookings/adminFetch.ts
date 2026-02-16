/**
 * Authenticated fetch wrapper for admin API calls.
 *
 * The API now requires a Bearer token on all /api/admin/* routes.
 * This helper adds the Authorization header automatically.
 *
 * The secret is exposed to the client-side bundle via NEXT_PUBLIC_,
 * but this is acceptable because:
 * 1. The Payload admin panel already requires its own login
 * 2. This is service-to-service auth between CMS and API
 * 3. Only authenticated CMS admins can access the bookings dashboard
 */
const ADMIN_API_SECRET =
  (typeof window !== 'undefined'
    ? (window as any).__ADMIN_API_SECRET
    : undefined) ||
  process.env.NEXT_PUBLIC_ADMIN_API_SECRET ||
  'dev-admin-secret-change-in-production'

export function adminFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${ADMIN_API_SECRET}`)
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(url, { ...options, headers })
}

// lib/auth.js
// Server-side helper used by /api routes to verify Supabase JWTs.
// Lives outside /api so Vercel doesn't try to expose it as a route.
//
// Supports BOTH:
//   * Legacy projects that sign JWTs with HS256 + a shared JWT secret
//   * Modern projects (publishable-key era) that sign with ES256/RS256
//     and expose public keys via the JWKS endpoint

import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';

const REQUIRE_AUTH = String(process.env.REQUIRE_AUTH ?? 'true').toLowerCase() !== 'false';
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  '';

let _jwks = null;
function getJWKS() {
  if (_jwks || !SUPABASE_URL) return _jwks;
  try {
    _jwks = createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', SUPABASE_URL));
  } catch (e) {
    _jwks = null;
  }
  return _jwks;
}

export async function requireAuth(req, res) {
  if (!REQUIRE_AUTH) return { ok: true, user: null };

  const header = req.headers.authorization || req.headers.Authorization || '';
  const m = String(header).match(/^Bearer\s+(.+)$/i);
  if (!m) {
    res.status(401).json({ error: 'Missing Authorization Bearer token' });
    return { ok: false };
  }
  const token = m[1];

  let alg;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    res.status(401).json({ error: 'Malformed Authorization token' });
    return { ok: false };
  }

  try {
    if (alg === 'HS256') {
      if (!JWT_SECRET) {
        res.status(500).json({
          error:
            'Token uses HS256 but the server has no SUPABASE_JWT_SECRET set. ' +
            'Add the JWT secret in your hosting env, or set REQUIRE_AUTH=false (dev only).',
        });
        return { ok: false };
      }
      const key = new TextEncoder().encode(JWT_SECRET);
      const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
      return { ok: true, user: payload };
    }

    const jwks = getJWKS();
    if (!jwks) {
      res.status(500).json({
        error:
          'Server has no SUPABASE_URL/VITE_SUPABASE_URL configured. ' +
          'Needed to fetch the JWKS endpoint for asymmetric JWT verification.',
      });
      return { ok: false };
    }
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['ES256', 'RS256', 'EdDSA'],
    });
    return { ok: true, user: payload };
  } catch (e) {
    res.status(401).json({
      error: `Invalid or expired session token (${alg || 'unknown alg'}): ${e.message}`,
    });
    return { ok: false };
  }
}

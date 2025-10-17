import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { rateLimiter } from 'hono-rate-limiter';
import { apiRouter } from './routes/api';
import { authRouter } from './routes/auth';
import { env } from './config/env';
import { isOriginAllowed, parseAllowedOrigins } from './utils/cors';

export const app = new Hono();

// Parse allowed origins from environment variable
const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

// Security Headers (CSP, HSTS, COOP, COEP)
app.use('*', async (c, next) => {
  // Apply security headers
  await secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://*.sent-tech.ca"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    },
    // Only add HSTS header for HTTPS requests
    strictTransportSecurity: c.req.header('x-forwarded-proto') === 'https' || 
                            c.req.header('x-forwarded-ssl') === 'on' ||
                            c.req.url.startsWith('https://') ? 
                            'max-age=31536000; includeSubDomains; preload' : undefined,
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginEmbedderPolicy: 'require-corp',
    crossOriginResourcePolicy: 'same-origin',
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    xXssProtection: '1; mode=block',
    referrerPolicy: 'strict-origin-when-cross-origin',
  })(c, next);
});

// Custom CORS middleware (strict mode with credentials)
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const method = c.req.method;
  
  // Handle preflight OPTIONS requests
  if (method === 'OPTIONS') {
    if (origin && isOriginAllowed(origin, allowedOrigins)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      c.header('Access-Control-Allow-Credentials', 'true');
      c.header('Access-Control-Max-Age', '86400');
    }
    return c.body(null, 204);
  }
  
  // Handle actual requests
  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
  }
  
  await next();
});

// Rate limiting for auth routes
const authSessionRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 30, // 30 requests per minute (very permissive for session checks)
  standardHeaders: 'draft-7',
  keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
});

const authLoginRateLimiter = rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  limit: 10, // 10 login attempts per minute (reasonable for login attempts)
  standardHeaders: 'draft-7',
  keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
});

const authRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // 10 requests per window
  standardHeaders: 'draft-7',
  keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
});

const authRegisterRateLimiter = rateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3, // 3 registrations per hour
  standardHeaders: 'draft-7',
  keyGenerator: (c) => c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
});

const magicLinkRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 3, // 3 magic links per 15 minutes
  standardHeaders: 'draft-7',
  keyGenerator: (c) => {
    // Rate limit by email if available in request body
    try {
      const body = c.req.json() as any;
      return body?.email || c.req.header('x-forwarded-for') || 'unknown';
    } catch {
      return c.req.header('x-forwarded-for') || 'unknown';
    }
  },
});

// Apply rate limiters to auth routes (order matters!)
// Skip rate limiting in test environment
if (!env.DISABLE_RATE_LIMIT) {
  // 1. Most specific routes first
  app.use('/api/v1/auth/session*', authSessionRateLimiter);
  app.use('/api/v1/auth/login/*', authLoginRateLimiter);
  app.use('/api/v1/auth/register/*', authRegisterRateLimiter);
  app.use('/api/v1/auth/magic-link/*', magicLinkRateLimiter);
  // 2. General auth routes last (excludes already matched routes)
  app.use('/api/v1/auth/*', authRateLimiter);
}

app.route('/api/v1', apiRouter);
app.route('/api/v1/auth', authRouter);

app.get('/', (c) => c.json({ name: 'Top AI Ideas API', version: '0.1.0' }));

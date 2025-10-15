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
app.use('*', secureHeaders({
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
  strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginEmbedderPolicy: 'require-corp',
  crossOriginResourcePolicy: 'same-origin',
  xContentTypeOptions: 'nosniff',
  xFrameOptions: 'DENY',
  xXssProtection: '1; mode=block',
  referrerPolicy: 'strict-origin-when-cross-origin',
}));

// Configuration CORS (strict mode with credentials)
app.use('*', cors({
  origin: (origin) => {
    // Allow requests with no origin (e.g., mobile apps, curl)
    if (!origin) return null;
    
    return isOriginAllowed(origin, allowedOrigins) ? origin : null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // 24 hours preflight cache
}));

// Rate limiting for auth routes
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

// Apply rate limiters to auth routes
app.use('/auth/*', authRateLimiter);
app.use('/auth/register/*', authRegisterRateLimiter);
app.use('/auth/magic-link/*', magicLinkRateLimiter);

app.route('/api/v1', apiRouter);
app.route('/auth', authRouter);

app.get('/', (c) => c.json({ name: 'Top AI Ideas API', version: '0.1.0' }));

// Backward-compatible alias: /companies routes map to /organizations handlers.
// This file exists only to avoid touching too many imports at once.
export { organizationsRouter as companiesRouter } from './organizations';


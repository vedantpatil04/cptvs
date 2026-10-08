/**
 * Default CPVTS branding — the only place these strings are defined.
 * Every deployment can override them through VITE_BRAND_* environment
 * variables (see `.env.example`). Components read branding from
 * `@/config/branding`, never from literals.
 */
export const BRANDING_DEFAULTS = {
  VITE_BRAND_SHORT_NAME: 'CPVTS',
  VITE_BRAND_PRODUCT_NAME: 'Campus Parking & Vehicle Tracking System',
  VITE_BRAND_INSTITUTION_NAME: 'Bharatesh Institute of Technology, Belagavi',
  VITE_BRAND_SHOW_DEMO_NOTICE: 'true',
} as const;

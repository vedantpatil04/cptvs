import { BRANDING_DEFAULTS } from './branding-defaults';

export interface Branding {
  /** Short product name, e.g. "CPVTS". */
  shortName: string;
  /** Full product name, e.g. "Campus Parking & Vehicle Tracking System". */
  productName: string;
  /** Institution the deployment is prepared for. */
  institutionName: string;
  /** Whether to show the "demonstration deployment, not official" notice. */
  showDemoNotice: boolean;
}

const read = (key: keyof typeof BRANDING_DEFAULTS): string =>
  import.meta.env[key]?.trim() || BRANDING_DEFAULTS[key];

/** Deployment branding. Change via VITE_BRAND_* variables, never in components. */
export const branding: Branding = Object.freeze({
  shortName: read('VITE_BRAND_SHORT_NAME'),
  productName: read('VITE_BRAND_PRODUCT_NAME'),
  institutionName: read('VITE_BRAND_INSTITUTION_NAME'),
  showDemoNotice: read('VITE_BRAND_SHOW_DEMO_NOTICE').toLowerCase() !== 'false',
});

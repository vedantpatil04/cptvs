/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_BRAND_SHORT_NAME: string;
  readonly VITE_BRAND_PRODUCT_NAME: string;
  readonly VITE_BRAND_INSTITUTION_NAME: string;
  readonly VITE_BRAND_SHOW_DEMO_NOTICE: string;
  readonly VITE_DEFAULT_LOCALE?: string;
  /** Optional photography; see `config/images.ts`. */
  readonly VITE_IMAGE_HERO?: string;
  readonly VITE_IMAGE_TWO_WHEELER_BLOCK?: string;
  readonly VITE_IMAGE_FOUR_WHEELER_BLOCK?: string;
  readonly VITE_IMAGE_CAMPUS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

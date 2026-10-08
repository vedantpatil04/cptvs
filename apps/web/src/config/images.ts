/**
 * Photography slots. The repository ships no photographs: each slot is filled
 * from an optional VITE_IMAGE_* variable (a path under `public/` such as
 * `/images/hero.jpg`, or an https URL). Without a value the page shows a
 * designed placeholder, so real campus photos can be dropped in later without
 * touching any layout.
 */
export const IMAGE_SLOTS = ['hero', 'twoWheelerBlock', 'fourWheelerBlock', 'campus'] as const;
export type ImageSlotId = (typeof IMAGE_SLOTS)[number];

const read = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  // Only same-origin paths and https URLs; anything else is ignored.
  return trimmed.startsWith('/') || trimmed.startsWith('https://') ? trimmed : null;
};

export const IMAGES: Readonly<Record<ImageSlotId, string | null>> = Object.freeze({
  hero: read(import.meta.env.VITE_IMAGE_HERO),
  twoWheelerBlock: read(import.meta.env.VITE_IMAGE_TWO_WHEELER_BLOCK),
  fourWheelerBlock: read(import.meta.env.VITE_IMAGE_FOUR_WHEELER_BLOCK),
  campus: read(import.meta.env.VITE_IMAGE_CAMPUS),
});

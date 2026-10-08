export interface Coordinates {
  latitude: number;
  longitude: number;
}

/**
 * Google Maps link for a parking block's real-world location. Uses the public
 * Maps URL scheme (no API key, no embedded map). Coordinates must come from
 * the backend — never invent them.
 */
export const googleMapsUrl = ({ latitude, longitude }: Coordinates): string =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;

/** RFC 5987 percent-encoding for the `filename*` parameter. */
const encodeExtended = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/**
 * A `Content-Disposition` header value (RFC 6266): an ASCII-only `filename` for old clients
 * plus the exact name in `filename*`. File names reach us only after being cleaned at upload,
 * but the header is built defensively all the same (no quotes, backslashes or control characters).
 */
export const contentDisposition = (type: 'inline' | 'attachment', fileName: string): string => {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeExtended(fileName)}`;
};

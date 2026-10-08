import type { ApiErrorBody, ApiErrorCode, ApiValidationIssue } from '@cpvts/shared';

import { appConfig } from '@/config/env';
import i18n from '@/i18n';

/** Generous timeout: free-tier hosts may need time to wake from idle. */
const REQUEST_TIMEOUT_MS = 60_000;

export type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR';

/** Error raised for any failed API call. `code` drives the translated message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly details: ApiValidationIssue[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Attach the stored access token (default true). */
  authenticated?: boolean;
}

type TokenProvider = () => string | null;
type UnauthorizedHandler = () => void;

let getAccessToken: TokenProvider = () => null;
let onUnauthorized: UnauthorizedHandler = () => {};

/** Wires the client to the auth layer without a circular import. */
export const configureApiClient = (options: {
  getAccessToken: TokenProvider;
  onUnauthorized: UnauthorizedHandler;
}): void => {
  getAccessToken = options.getAccessToken;
  onUnauthorized = options.onUnauthorized;
};

const isApiErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ApiErrorBody).error?.code === 'string';

const parseJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const send = async (
  path: string,
  { method = 'GET', body, signal, authenticated = true }: RequestOptions,
  accept: string,
): Promise<Response> => {
  const headers = new Headers({ Accept: accept, 'Accept-Language': i18n.language });
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  const token = authenticated ? getAccessToken() : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached.');
  }

  if (!response.ok) {
    if (response.status === 401 && token) onUnauthorized();
    const payload = await parseJson(response);
    if (isApiErrorBody(payload)) {
      const { code, message, details } = payload.error;
      throw new ApiError(response.status, code, message, details);
    }
    throw new ApiError(
      response.status,
      response.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'BAD_REQUEST',
      `Request failed with status ${response.status}.`,
    );
  }
  return response;
};

/** Performs a JSON request against the CPVTS REST API (`/api/v1`). */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options, 'application/json');
  return (await parseJson(response)) as T;
}

const filenameFrom = (disposition: string | null): string | null =>
  disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? null;

/** Downloads a file (e.g. a CSV report) with the caller's credentials. */
export async function apiDownload(
  path: string,
  options: RequestOptions = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await send(path, options, '*/*');
  return {
    blob: await response.blob(),
    filename: filenameFrom(response.headers.get('Content-Disposition')),
  };
}

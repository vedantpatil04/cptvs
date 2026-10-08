import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

const HEADER = 'X-Request-Id';
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Accepts a well-formed upstream request ID (e.g. from a proxy) or generates one. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get(HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(HEADER, req.id);
  next();
};

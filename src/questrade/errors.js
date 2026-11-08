/**
 * Errors whose message is safe and useful to show the model as-is. Anything
 * else is reported as "Unexpected error in <tool>" and logged with its stack.
 */
export class QuestradeError extends Error {
  constructor(message, { code = 'QUESTRADE_ERROR', status, questradeCode, retryable = false } = {}) {
    super(message);
    this.name = 'QuestradeError';
    this.code = code;
    this.status = status;
    this.questradeCode = questradeCode;
    this.retryable = retryable;
  }
}

/** Missing, rejected or spent credentials: the message says how to sign in. */
export class QuestradeAuthError extends QuestradeError {
  constructor(message, { code = 'AUTH_REQUIRED', ...rest } = {}) {
    super(message, { code, ...rest });
    this.name = 'QuestradeAuthError';
  }
}

/** Questrade error codes that need a hint beyond Questrade's own message. */
const HINTS = {
  1003: 'The request is too large (activities allow at most 31 days per request; this server splits ranges, so narrow startDate/endDate).',
  1006: 'Questrade rate limit reached; wait a moment and retry.',
  1017: 'The access token is invalid.',
};

/** Build an error from a Questrade response body ({ code, message }). */
export function fromResponse(status, body, path) {
  const qcode = typeof body?.code === 'number' ? body.code : undefined;
  const message = body?.message || `HTTP ${status}`;
  const hint = qcode ? HINTS[qcode] : undefined;
  const code = status === 404 ? 'NOT_FOUND' : status === 429 ? 'RATE_LIMITED' : status >= 500 ? 'QUESTRADE_UNAVAILABLE' : 'QUESTRADE_REJECTED';
  return new QuestradeError(`Questrade rejected ${path}: ${message}${qcode ? ` [${qcode}]` : ''}${hint ? `. ${hint}` : ''}`, {
    code,
    status,
    questradeCode: qcode,
    retryable: status === 429 || status >= 500,
  });
}

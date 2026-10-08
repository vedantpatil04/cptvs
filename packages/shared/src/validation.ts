/**
 * Validation messages are translation keys, not English sentences, so the same
 * schema can be enforced on the server and rendered in any supported language
 * on the client. Every key here must exist in the web app's locale files.
 */
export const VALIDATION_MESSAGES = {
  required: 'validation.required',
  tooLong: 'validation.tooLong',
  passwordTooShort: 'validation.passwordTooShort',
  passwordTooLong: 'validation.passwordTooLong',
} as const;

export type ValidationMessageKey = (typeof VALIDATION_MESSAGES)[keyof typeof VALIDATION_MESSAGES];

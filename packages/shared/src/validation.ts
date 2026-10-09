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
  selectOption: 'validation.selectOption',
  invalidVehicleNumber: 'validation.invalidVehicleNumber',
  invalidHour: 'validation.invalidHour',
  invalidSessionNumber: 'validation.invalidSessionNumber',
  invalidSlotCode: 'validation.invalidSlotCode',
  invalidDate: 'validation.invalidDate',
  invalidDateRange: 'validation.invalidDateRange',
  outOfRange: 'validation.outOfRange',
  coordinatesPaired: 'validation.coordinatesPaired',
  invalidEmail: 'validation.invalidEmail',
  emailDomain: 'validation.emailDomain',
  invalidPhone: 'validation.invalidPhone',
  invalidInstitutionalId: 'validation.invalidInstitutionalId',
  institutionalIdMismatch: 'validation.institutionalIdMismatch',
  documentRequired: 'validation.documentRequired',
  documentTooLarge: 'validation.documentTooLarge',
  documentType: 'validation.documentType',
  passwordsDoNotMatch: 'validation.passwordsDoNotMatch',
  rejectionNoteRequired: 'validation.rejectionNoteRequired',
  invalidInventoryCode: 'validation.invalidInventoryCode',
  slotCodePrefix: 'validation.slotCodePrefix',
  nothingToUpdate: 'validation.nothingToUpdate',
  semesterOutOfRange: 'validation.semesterOutOfRange',
  admissionYearInvalid: 'validation.admissionYearInvalid',
  academicIncomplete: 'validation.academicIncomplete',
  invalidTime: 'validation.invalidTime',
  shiftTimesEqual: 'validation.shiftTimesEqual',
  invalidBatch: 'validation.invalidBatch',
  invalidExitCode: 'validation.invalidExitCode',
} as const;

export type ValidationMessageKey = (typeof VALIDATION_MESSAGES)[keyof typeof VALIDATION_MESSAGES];

import { z } from 'zod';

import { VALIDATION_MESSAGES } from './validation.js';

/**
 * Student academic identity: just enough for an administrator to find and track
 * students for parking administration. This is deliberately not a college ERP —
 * there are no subjects, marks, attendance, timetables, faculty or exams.
 */

export const ACADEMIC_PROGRAMS = ['BCA', 'BCOM', 'BBA', 'MCA', 'MBA'] as const;
export type AcademicProgram = (typeof ACADEMIC_PROGRAMS)[number];

export type ProgramLevel = 'UG' | 'PG';

export interface ProgramInfo {
  /** Display name, e.g. "B.Com". */
  label: string;
  level: ProgramLevel;
  durationYears: number;
  /** Two semesters per year. */
  semesters: number;
}

/** Undergraduate programs run 3 years (6 semesters); postgraduate programs 2 years (4 semesters). */
export const PROGRAMS: Record<AcademicProgram, ProgramInfo> = {
  BCA: { label: 'BCA', level: 'UG', durationYears: 3, semesters: 6 },
  BCOM: { label: 'B.Com', level: 'UG', durationYears: 3, semesters: 6 },
  BBA: { label: 'BBA', level: 'UG', durationYears: 3, semesters: 6 },
  MCA: { label: 'MCA', level: 'PG', durationYears: 2, semesters: 4 },
  MBA: { label: 'MBA', level: 'PG', durationYears: 2, semesters: 4 },
};

export const isAcademicProgram = (value: unknown): value is AcademicProgram =>
  typeof value === 'string' && (ACADEMIC_PROGRAMS as readonly string[]).includes(value);

/** Highest semester of a program: 6 for BCA / B.Com / BBA, 4 for MCA / MBA. */
export const maxSemesterOf = (program: AcademicProgram): number => PROGRAMS[program].semesters;

// ---------------------------------------------------------------------------
// Batch: derived from the admission year and the program duration
// ---------------------------------------------------------------------------

export interface Batch {
  startYear: number;
  endYear: number;
  /** Display label, e.g. "2024–2027" (en dash). */
  label: string;
}

/** BCA + 2024 → 2024–2027; MCA + 2024 → 2024–2026. A batch is never typed by the student. */
export const batchOf = (program: AcademicProgram, admissionYear: number): Batch => {
  const endYear = admissionYear + PROGRAMS[program].durationYears;
  return { startYear: admissionYear, endYear, label: `${admissionYear}–${endYear}` };
};

/** Reads "2024–2027" or "2024-2027" (as used in filters); null if it is not a batch label. */
export const parseBatchLabel = (value: string): { startYear: number; endYear: number } | null => {
  const match = /^(\d{4})\s*[-–—]\s*(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  return endYear > startYear ? { startYear, endYear } : null;
};

/** Programs whose batch is `startYear`–`endYear` (decided by the program duration). */
export const programsForBatch = (startYear: number, endYear: number): AcademicProgram[] =>
  ACADEMIC_PROGRAMS.filter((program) => PROGRAMS[program].durationYears === endYear - startYear);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** The earliest admission year accepted. */
export const MIN_ADMISSION_YEAR = 2000;

const numeric = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() !== '' ? Number(value) : value;

/** Collapses internal whitespace, e.g. "  Computer   Applications " → "Computer Applications". */
export const normalizeDepartment = (value: string): string => value.trim().replace(/\s+/g, ' ');

export const departmentSchema = z
  .string({ error: VALIDATION_MESSAGES.required })
  .transform(normalizeDepartment)
  .pipe(
    z
      .string()
      .min(2, { error: VALIDATION_MESSAGES.required })
      .max(80, { error: VALIDATION_MESSAGES.tooLong }),
  );

/** From `MIN_ADMISSION_YEAR` up to the current calendar year (evaluated when parsing). */
export const admissionYearSchema = z.preprocess(
  numeric,
  z
    .number({ error: VALIDATION_MESSAGES.admissionYearInvalid })
    .int({ error: VALIDATION_MESSAGES.admissionYearInvalid })
    .min(MIN_ADMISSION_YEAR, { error: VALIDATION_MESSAGES.admissionYearInvalid })
    .refine((year) => year <= new Date().getFullYear(), {
      error: VALIDATION_MESSAGES.admissionYearInvalid,
    }),
);

/** 1–6 here; the limit of the chosen program (6 or 4) is checked together with the program. */
export const semesterSchema = z.preprocess(
  numeric,
  z
    .number({ error: VALIDATION_MESSAGES.semesterOutOfRange })
    .int({ error: VALIDATION_MESSAGES.semesterOutOfRange })
    .min(1, { error: VALIDATION_MESSAGES.semesterOutOfRange })
    .max(6, { error: VALIDATION_MESSAGES.semesterOutOfRange }),
);

const programSchema = z.enum(ACADEMIC_PROGRAMS, { error: VALIDATION_MESSAGES.selectOption });

/** The semester must exist in the program: 1–6 for BCA / B.Com / BBA, 1–4 for MCA / MBA. */
const semesterFitsProgram = (value: { program: AcademicProgram; currentSemester: number }) =>
  value.currentSemester <= maxSemesterOf(value.program);

/** Everything a student gives at registration. */
export const academicProfileSchema = z
  .object({
    program: programSchema,
    department: departmentSchema,
    admissionYear: admissionYearSchema,
    currentSemester: semesterSchema,
  })
  .refine(semesterFitsProgram, {
    path: ['currentSemester'],
    error: VALIDATION_MESSAGES.semesterOutOfRange,
  });
export type AcademicProfileInput = z.input<typeof academicProfileSchema>;
export type AcademicProfile = z.output<typeof academicProfileSchema>;

/** An administrator's correction: any subset; the merged result is validated together. */
export const academicProfileUpdateSchema = z
  .object({
    program: programSchema.optional(),
    department: departmentSchema.optional(),
    admissionYear: admissionYearSchema.optional(),
    currentSemester: semesterSchema.optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: VALIDATION_MESSAGES.nothingToUpdate,
  });
export type AcademicProfileUpdate = z.input<typeof academicProfileUpdateSchema>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export interface AcademicProfileView {
  program: AcademicProgram;
  /** Display name of the program, e.g. "B.Com". */
  programLabel: string;
  level: ProgramLevel;
  department: string;
  admissionYear: number;
  /** Derived: "2024–2027" for BCA / B.Com / BBA admitted in 2024. */
  batch: string;
  batchStartYear: number;
  batchEndYear: number;
  currentSemester: number;
  /** 6 for UG programs, 4 for PG programs. */
  maxSemester: number;
}

export const toAcademicProfileView = (profile: {
  program: AcademicProgram;
  department: string;
  admissionYear: number;
  currentSemester: number;
}): AcademicProfileView => {
  const info = PROGRAMS[profile.program];
  const batch = batchOf(profile.program, profile.admissionYear);
  return {
    program: profile.program,
    programLabel: info.label,
    level: info.level,
    department: profile.department,
    admissionYear: profile.admissionYear,
    batch: batch.label,
    batchStartYear: batch.startYear,
    batchEndYear: batch.endYear,
    currentSemester: profile.currentSemester,
    maxSemester: info.semesters,
  };
};

/** Values for the Admin filter dropdowns: what exists in the data, plus the fixed lists. */
export interface AcademicFacets {
  programs: { program: AcademicProgram; label: string; level: ProgramLevel; semesters: number }[];
  /** Distinct departments in use, alphabetical. */
  departments: string[];
  /** Distinct batches in use, newest first, e.g. "2024–2027". */
  batches: string[];
  /** Students without academic details yet (accounts created before they were collected). */
  studentsMissingAcademicProfile: number;
}

import { z } from 'zod';

export const loginModeSchema = z.enum(['host', 'student']);
export const assessmentTypeSchema = z.enum(['quiz', 'poll']);
export const privacyModeSchema = z.enum(['anonymous', 'normal']);
export const questionTypeSchema = z.enum(['mcq', 'multi_select', 'short_answer', 'paragraph']);

export const loginRequestSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').max(200),
  password: z.string().min(6, 'Password must be at least 6 characters.').max(128),
  requestedMode: loginModeSchema.optional(),
});

export const googleLoginSchema = z.object({
  idToken: z.string().min(20),
  requestedMode: loginModeSchema.optional(),
});

export const bootstrapAdminSchema = z.object({
  institutionName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(200),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
});

export const registerStudentSchema = z.object({
  displayName: z.string().trim().min(2, 'Full name is required.').max(100),
  email: z.string().trim().email('Please enter a valid email address.').max(200),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(128),
  classSection: z.string().trim().max(80).optional(),
  studentCode: z.string().trim().max(40).optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().max(200),
});

export const resetPasswordSchema = z.object({
  email: z.string().trim().email().max(200),
  token: z.string().trim().min(10).max(200),
  newPassword: z.string().min(8).max(128),
});

export const questionOptionInputSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1, 'Option label cannot be empty.').max(300),
  isCorrect: z.boolean().optional().default(false),
});

export const questionInputSchema = z.object({
  id: z.string().uuid().optional(),
  type: questionTypeSchema,
  text: z.string().trim().min(1, 'Question text is required.').max(2000),
  points: z.number().min(0, 'Marks cannot be negative.').max(1000).default(0),
  rubric: z.string().trim().max(2000).optional().nullable(),
  settings: z
    .object({
      partialCredit: z.boolean().optional().default(false),
      required: z.boolean().optional().default(true),
    })
    .optional()
    .default({ partialCredit: false, required: true }),
  options: z.array(questionOptionInputSchema).max(12).optional().default([]),
});

export const createAssessmentSchema = z
  .object({
    type: assessmentTypeSchema,
    title: z.string().trim().min(2, 'Title must be at least 2 characters.').max(180),
    description: z.string().trim().max(1500).optional().default(''),
    instructions: z.string().trim().max(2000).optional().default(''),
    privacyMode: privacyModeSchema,
    durationMinutes: z.number().int().min(1).max(480).default(15),
    settings: z
      .object({
        allowAlias: z.boolean().optional().default(true),
        showMarksToStudents: z.boolean().optional().default(true),
        partialCreditDefault: z.enum(['none', 'proportional']).optional().default('none'),
      })
      .optional()
      .default({ allowAlias: true, showMarksToStudents: true, partialCreditDefault: 'none' }),
    questions: z.array(questionInputSchema).max(100).default([]),
  })
  .superRefine((data, ctx) => {
    data.questions.forEach((q, idx) => {
      const isChoice = q.type === 'mcq' || q.type === 'multi_select';
      if (isChoice && q.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Question ${idx + 1} must have at least 2 options.`,
          path: ['questions', idx, 'options'],
        });
      }
      if (data.type === 'poll') {
        if (q.points > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Poll question ${idx + 1} cannot have marks.`,
            path: ['questions', idx, 'points'],
          });
        }
        if (q.options.some((o) => o.isCorrect)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Poll question ${idx + 1} cannot specify correct answers.`,
            path: ['questions', idx, 'options'],
          });
        }
      } else {
        // Quiz mode checks
        if (q.points < 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Quiz question ${idx + 1} cannot have negative marks.`,
            path: ['questions', idx, 'points'],
          });
        }
        if (isChoice && !q.options.some((o) => o.isCorrect)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Quiz choice question ${idx + 1} must mark at least one correct option.`,
            path: ['questions', idx, 'options'],
          });
        }
      }
    });
  });

export const launchSessionSchema = z.object({
  durationMinutes: z.number().int().min(1).max(480).optional(),
});

export const extendSessionSchema = z.object({
  additionalMinutes: z.number().int().min(1).max(180),
});

export const resolveCodeSchema = z.object({
  code: z.string().trim().min(1).max(20),
});

export const verifyQrSchema = z.object({
  payload: z.string().trim().min(5).max(1000),
});

export const startSessionSchema = z.object({
  alias: z.string().trim().max(60).optional(),
});

export const submitAssessmentSchema = z.object({
  sessionToken: z.string().min(16).max(1024),
  alias: z.string().trim().max(60).optional(),
  autoSubmitted: z.boolean().optional().default(false),
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        selectedOptionIds: z.array(z.string().uuid()).max(20).optional().default([]),
        textAnswer: z.string().max(5000).optional().nullable(),
      })
    )
    .max(100),
});

export const gradeSubmissionSchema = z.object({
  grades: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        awardedPoints: z.number().min(0).max(1000),
        feedback: z.string().trim().max(2000).optional().nullable(),
      })
    )
    .min(1),
});

export const recalculateSchema = z.object({
  resetManualGrades: z.boolean().optional().default(false),
  reason: z.string().trim().max(500).optional(),
});

// Strict allowlist for Host editing a student profile
export const updateStudentProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  classSection: z.string().trim().max(80).nullable().optional(),
  department: z.string().trim().max(80).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  status: z.enum(['active', 'suspended']).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
});

export const createStudentByHostSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(128),
  studentCode: z.string().trim().max(40).optional(),
  classSection: z.string().trim().max(80).optional(),
  department: z.string().trim().max(80).optional(),
});

export const serverRecordInputSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  host: z.string().trim().min(2).max(255),
  port: z.number().int().min(1).max(65535),
  protocol: z.enum(['https', 'http']),
  apiBaseUrl: z.string().trim().url().max(500),
  environment: z.enum(['development', 'staging', 'production']),
  isEnabled: z.boolean().optional().default(true),
});

export const updateSettingsSchema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  department: z.string().trim().max(80).nullable().optional(),
  institutionName: z.string().trim().min(2).max(120).optional(),
  allowStudentSelfRegistration: z.boolean().optional(),
  defaultPrivacyMode: privacyModeSchema.optional(),
});

export const addHostSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').max(200),
  displayName: z.string().trim().max(100).optional(),
});

export const removeHostSchema = z.object({
  email: z.string().trim().email('Please enter a valid email address.').max(200),
});

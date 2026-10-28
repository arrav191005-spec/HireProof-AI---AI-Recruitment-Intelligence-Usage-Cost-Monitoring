import { z } from 'zod';

export const skillRequirementSchema = z.object({
  skill: z.string().min(1).max(80),
  minYears: z.number().min(0).max(50).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

export const jobCreateSchema = z.object({
  title: z.string().min(2, 'Title must be at least 2 characters').max(120),
  department: z.string().max(80).default('Engineering'),
  location: z.string().max(120).default('Remote'),
  employmentType: z.enum(['Full-time', 'Part-time', 'Contract', 'Internship']).default('Full-time'),
  status: z.enum(['draft', 'open', 'closed']).default('draft'),
  experienceMin: z.number().int().min(0).max(50).nullable().optional(),
  experienceMax: z.number().int().min(0).max(50).nullable().optional(),
  description: z.string().max(8000).default(''),
  requiredSkills: z.array(skillRequirementSchema).max(20).default([]),
  preferredSkills: z.array(skillRequirementSchema).max(20).default([]),
});

export const jobUpdateSchema = jobCreateSchema.partial();

export const searchRequestSchema = z.object({
  query: z.string().max(500).default(''),
  jobId: z.string().max(80).nullable().optional(),
  filters: z
    .object({
      skill: z.string().max(80).optional(),
      minYears: z.union([z.number(), z.string()]).optional(),
      maxYears: z.union([z.number(), z.string()]).optional(),
      assessmentStatus: z.enum(['any', 'completed', 'none']).optional(),
      // "" means "Any status" in the UI — accept it and treat it as no filter
      // (the search engine skips the filter when the value is falsy).
      evidenceStatus: z
        .union([
          z.literal(''),
          z.enum(['claimed', 'supporting', 'assessment', 'not_established', 'needs_review']),
        ])
        .optional(),
      onlyApplicants: z.boolean().optional(),
      sort: z.enum(['relevance', 'experience', 'name']).optional(),
    })
    .default({}),
  page: z.number().int().min(1).max(100).default(1),
  pageSize: z.number().int().min(1).max(50).default(8),
});

export const assessmentCreateSchema = z.object({
  title: z.string().min(2).max(140),
  skill: z.string().min(1).max(80),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  description: z.string().max(4000).default(''),
  instructions: z.string().max(8000).default(''),
  timeLimitMinutes: z.number().int().min(5).max(480).default(45),
  status: z.enum(['draft', 'published']).default('draft'),
});

export const submissionCreateSchema = z.object({
  candidateId: z.string().min(1).max(80),
  code: z.string().max(20_000).optional(),
  answers: z.string().max(20_000).optional(),
});

export const evidenceReviewSchema = z.object({
  status: z.enum(['claimed', 'supporting', 'assessment', 'not_established', 'needs_review']),
  notes: z.string().max(2000).optional(),
});

export const candidateUpdateSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  headline: z.string().max(160).optional(),
  location: z.string().max(120).optional(),
  email: z.string().max(160).optional(),
  summary: z.string().max(4000).optional(),
  currentCompany: z.string().max(160).nullable().optional(),
  yearsExperience: z.number().min(0).max(60).nullable().optional(),
});

export const evidenceCreateSchema = z.object({
  skill: z.string().min(1).max(80),
  excerpt: z.string().min(3, 'Provide the source excerpt this evidence is based on').max(1000),
  notes: z.string().max(2000).optional(),
});

export const applicationCreateSchema = z.object({
  candidateId: z.string().min(1).max(80),
  jobId: z.string().min(1).max(80),
  stage: z.enum(['applied', 'screening', 'assessment', 'interview', 'offer', 'hired', 'rejected']).default('applied'),
});

export const interviewQuestionsSchema = z.object({
  jobId: z.string().min(1).max(80),
  skill: z.string().min(1).max(80),
  count: z.number().int().min(1).max(5).default(3),
});

export const submissionReviewSchema = z.object({
  status: z.enum(['pending', 'manual_review', 'completed', 'failed']).optional(),
  score: z.number().min(0).max(100).nullable().optional(),
  reviewerNote: z.string().max(2000).nullable().optional(),
});

// Reviewer-confirmed candidate creation. The extraction result stays on the
// server (storage/resumes/<uploadId>.meta.json); this payload only carries the
// fields a human edited during review, so nothing extracted can be smuggled in
// without review.
export const candidateCreateSchema = z.object({
  uploadId: z.string().regex(/^upl-[a-f0-9-]{8,}$/i, 'Unknown upload reference'),
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  headline: z.string().trim().max(160).optional(),
  email: z.string().trim().email('Enter a valid email address').max(160).nullable().optional(),
  location: z.string().trim().max(120).nullable().optional(),
  currentCompany: z.string().trim().max(160).nullable().optional(),
  yearsExperience: z.number().min(0).max(60).nullable().optional(),
  summary: z.string().trim().max(4000).optional(),
  // Skills the reviewer chose to REMOVE from the extraction (false positives).
  dropSkills: z.array(z.string().trim().min(1).max(80)).max(80).optional(),
});

export const applicationStageSchema = z.object({
  stage: z.enum(['applied', 'screening', 'assessment', 'interview', 'offer', 'hired', 'rejected']),
});

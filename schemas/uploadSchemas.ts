/**
 * schemas/uploadSchemas.ts
 *
 * Centralized Zod validation schemas for all upload API routes.
 * Keeps validation logic out of route handlers and reusable.
 */

import { z } from "zod";

// ── /api/upload/start ─────────────────────────
export const StartUploadSchema = z.object({
  fileName: z
    .string()
    .min(1, "fileName is required")
    .max(1024, "fileName too long"),
  fileType: z
    .string()
    .min(1, "fileType is required"),
  fileSize: z
    .number()
    .positive("fileSize must be greater than 0")
    .max(5 * 1024 * 1024 * 1024 * 1024, "fileSize exceeds 5TB S3 limit"),
});

export type StartUploadInput = z.infer<typeof StartUploadSchema>;

// ── /api/upload/complete ──────────────────────
export const CompletedPartSchema = z.object({
  PartNumber: z.number().int().min(1).max(10000),
  ETag: z.string().min(1, "ETag is required"),
});

export const CompleteUploadSchema = z.object({
  fileId: z.string().uuid("fileId must be a valid UUID"),
  uploadId: z.string().min(1, "uploadId is required"),
  parts: z
    .array(CompletedPartSchema)
    .min(1, "parts array must not be empty"),
});

export type CompleteUploadInput = z.infer<typeof CompleteUploadSchema>;

// ── /api/upload/abort ────────────────────────
export const AbortUploadSchema = z.object({
  fileId: z.string().uuid("fileId must be a valid UUID"),
});

export type AbortUploadInput = z.infer<typeof AbortUploadSchema>;

// ── /api/upload/status ────────────────────────
export const UploadStatusQuerySchema = z.object({
  fileId: z.string().uuid("fileId must be a valid UUID"),
});

// ── /api/upload/resume ────────────────────────
export const ResumeUploadSchema = z.object({
  fileId: z.string().uuid("fileId must be a valid UUID"),
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().positive(),
});

export type ResumeUploadInput = z.infer<typeof ResumeUploadSchema>;

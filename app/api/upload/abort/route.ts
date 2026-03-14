/**
 * POST /api/upload/abort
 *
 * Aborts an in-progress S3 multipart upload.
 * Cleans up the incomplete upload from S3 to avoid storage charges.
 * Updates MongoDB status to "failed".
 */

import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { FileModel } from "@/models/File";
import { abortMultipartUpload } from "@/lib/multipartUpload";
import { AbortUploadSchema } from "@/schemas/uploadSchemas";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── Zod validation ──
    const parsed = AbortUploadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }

    const { fileId } = parsed.data;

    await connectToDatabase();
    const file = await FileModel.findOne({ fileId });
    if (!file) {
      return NextResponse.json({ error: "File record not found" }, { status: 404 });
    }

    // Abort the S3 multipart upload — prevents orphaned parts incurring storage costs
    await abortMultipartUpload(file.s3Key, file.uploadId);

    file.status = "failed";
    await file.save();

    console.info(`[/api/upload/abort] fileId=${fileId} aborted`);
    return NextResponse.json({ success: true, fileId });
  } catch (error) {
    console.error("[/api/upload/abort] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

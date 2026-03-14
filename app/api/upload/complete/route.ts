/**
 * POST /api/upload/complete
 *
 * Finalizes a multipart upload in S3.
 * Validates input with Zod, calls CompleteMultipartUpload,
 * and updates MongoDB status to "uploaded".
 */

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { connectToDatabase } from "@/lib/mongodb";
import { FileModel } from "@/models/File";
import { completeMultipartUpload } from "@/lib/multipartUpload";
import { CompleteUploadSchema } from "@/schemas/uploadSchemas";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── Zod validation ──
    const parsed = CompleteUploadSchema.safeParse(body);
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
    }

    const { fileId, uploadId, parts } = parsed.data;

    await connectToDatabase();
    const file = await FileModel.findOne({ fileId });
    if (!file) {
      return NextResponse.json({ error: "File record not found" }, { status: 404 });
    }

    console.info(`[/api/upload/complete] fileId=${fileId} parts=${parts.length}`);

    const result = await completeMultipartUpload(file.s3Key, uploadId, parts);

    file.status = "uploaded";
    await file.save();

    return NextResponse.json({ success: true, location: result.Location, fileId });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error("[/api/upload/complete] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

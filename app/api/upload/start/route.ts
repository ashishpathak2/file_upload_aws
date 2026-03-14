/**
 * POST /api/upload/start
 *
 * Initiates a new S3 multipart upload.
 * Validates input with Zod, creates upload in S3,
 * generates presigned URLs, and saves record in MongoDB.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { ZodError } from "zod";
import { connectToDatabase } from "@/lib/mongodb";
import { FileModel } from "@/models/File";
import { createMultipartUpload, generatePresignedUrls } from "@/lib/multipartUpload";
import { StartUploadSchema } from "@/schemas/uploadSchemas";
import { calcChunkSize, calcPartCount } from "@/utils/chunkCalculator";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // ── Zod validation ──
    const parsed = StartUploadSchema.safeParse(body);
    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors;
      return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
    }

    const { fileName, fileType, fileSize } = parsed.data;

    const fileId = uuidv4();
    const s3Key = `uploads/${fileId}/${fileName}`;

    // Use dynamic chunk size based on file size
    const chunkSize = calcChunkSize(fileSize);
    const partCount = calcPartCount(fileSize);

    console.info(`[/api/upload/start] fileId=${fileId} parts=${partCount} chunkSize=${chunkSize}`);

    // Create multipart upload in S3
    const { UploadId } = await createMultipartUpload(s3Key, fileType);
    if (!UploadId) {
      return NextResponse.json({ error: "S3 failed to create multipart upload" }, { status: 500 });
    }

    // Generate presigned URLs for each part
    const presignedUrls = await generatePresignedUrls(s3Key, UploadId, partCount);

    // Save initial record to MongoDB
    await connectToDatabase();
    await FileModel.create({
      fileId,
      fileName,
      fileType,
      fileSize,
      s3Key,
      uploadId: UploadId,
      status: "initiated",
    });

    return NextResponse.json({ fileId, uploadId: UploadId, presignedUrls });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", details: err.flatten() }, { status: 400 });
    }
    console.error("[/api/upload/start] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/upload/status?fileId=xxx
 *
 * Returns which parts have already been uploaded to S3.
 * Used by the frontend to resume interrupted uploads.
 * Queries S3 ListPartsCommand for ground truth.
 */

import { NextRequest, NextResponse } from "next/server";
import { ListPartsCommand } from "@aws-sdk/client-s3";
import { connectToDatabase } from "@/lib/mongodb";
import { FileModel } from "@/models/File";
import { s3Client, S3_BUCKET_NAME } from "@/lib/s3Client";
import { UploadStatusQuerySchema } from "@/schemas/uploadSchemas";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get("fileId");

    // ── Validate query param ──
    const parsed = UploadStatusQuerySchema.safeParse({ fileId });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid fileId" }, { status: 400 });
    }

    await connectToDatabase();
    const file = await FileModel.findOne({ fileId: parsed.data.fileId });
    if (!file) {
      return NextResponse.json({ error: "File record not found" }, { status: 404 });
    }

    // Query S3 for list of already-uploaded parts
    const command = new ListPartsCommand({
      Bucket: S3_BUCKET_NAME,
      Key: file.s3Key,
      UploadId: file.uploadId,
    });

    const response = await s3Client.send(command);
    const uploadedParts = (response.Parts ?? []).map((p) => p.PartNumber ?? 0).filter(Boolean);

    console.info(`[/api/upload/status] fileId=${fileId} uploadedParts=${uploadedParts.length}`);

    return NextResponse.json({
      fileId,
      status: file.status,
      uploadedParts,
      uploadId: file.uploadId,
    });
  } catch (error) {
    console.error("[/api/upload/status] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

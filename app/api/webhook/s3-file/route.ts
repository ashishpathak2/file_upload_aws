/**
 * POST /api/webhook/s3-file
 *
 * Receives S3 event notifications when a multipart upload completes.
 * Validates webhook secret header, updates MongoDB status to "success".
 *
 * Security: expects x-webhook-secret header matching WEBHOOK_SECRET env var.
 */

import { NextRequest, NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { FileModel } from "@/models/File";
import { S3_BUCKET_NAME } from "@/lib/s3Client";

interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string; size?: number };
  };
  eventName?: string;
  eventTime?: string;
}

interface S3Event {
  Records: S3EventRecord[];
}

export async function POST(request: NextRequest) {
  try {
    // ── Webhook secret validation ──
    const webhookSecret = process.env.WEBHOOK_SECRET;
    if (webhookSecret) {
      const incomingSecret = request.headers.get("x-webhook-secret");
      if (incomingSecret !== webhookSecret) {
        console.warn("[/api/webhook/s3-file] Unauthorized webhook request");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = (await request.json()) as S3Event;

    if (!body.Records?.length) {
      return NextResponse.json({ error: "No records in event" }, { status: 400 });
    }

    await connectToDatabase();

    const results = await Promise.allSettled(
      body.Records.map(async (record) => {
        const bucketName = record.s3?.bucket?.name;
        const fileKey = record.s3?.object?.key;

        if (!bucketName || !fileKey) throw new Error("Missing bucket/key in event");
        if (bucketName !== S3_BUCKET_NAME) throw new Error(`Unexpected bucket: ${bucketName}`);

        // Extract fileId from key pattern: uploads/{fileId}/{fileName}
        const fileId = fileKey.split("/")[1];
        if (!fileId) throw new Error(`Cannot extract fileId from key: ${fileKey}`);

        const file = await FileModel.findOne({ fileId });
        if (!file) throw new Error(`File not found for fileId: ${fileId}`);

        const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileKey}`;

        file.status = "success";
        file.fileUrl = fileUrl;
        file.processedAt = new Date();
        await file.save();

        console.info(`[/api/webhook/s3-file] fileId=${fileId} status=success`);
        return { fileId, status: "success", fileUrl };
      })
    );

    const processed = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    return NextResponse.json({ processed, failed });
  } catch (error) {
    console.error("[/api/webhook/s3-file] Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

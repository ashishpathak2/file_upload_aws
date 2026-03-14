/**
 * lib/multipartUpload.ts
 *
 * Low-level AWS S3 multipart upload helpers.
 * All S3 SDK interactions are centralized here.
 */

import {
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListPartsCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, S3_BUCKET_NAME } from "./s3Client";

const PRESIGNED_URL_EXPIRY = 3600; // 1 hour

export async function createMultipartUpload(key: string, contentType: string) {
  const command = new CreateMultipartUploadCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });
  return s3Client.send(command);
}

export async function generatePresignedUrls(
  key: string,
  uploadId: string,
  partCount: number
): Promise<string[]> {
  return Promise.all(
    Array.from({ length: partCount }, (_, i) => {
      const command = new UploadPartCommand({
        Bucket: S3_BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        PartNumber: i + 1,
        ChecksumAlgorithm: undefined,
      });
      return getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRY });
    })
  );
}

export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: CompletedPart[]
) {
  const command = new CompleteMultipartUploadCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: parts },
  });
  return s3Client.send(command);
}

export async function abortMultipartUpload(key: string, uploadId: string) {
  const command = new AbortMultipartUploadCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
  });
  return s3Client.send(command);
}

export async function listUploadedParts(key: string, uploadId: string) {
  const command = new ListPartsCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
    UploadId: uploadId,
  });
  return s3Client.send(command);
}

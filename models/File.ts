import mongoose, { Schema, type Document } from "mongoose";

export type FileStatus = "initiated" | "uploaded" | "success" | "failed";

export interface IFile extends Document {
  fileId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  s3Key: string;
  uploadId: string;
  status: FileStatus;
  fileUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  processedAt?: Date;
}

const FileSchema = new Schema<IFile>(
  {
    fileId: { type: String, required: true, unique: true, index: true },
    fileName: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    s3Key: { type: String, required: true },
    uploadId: { type: String, required: true },
    status: {
      type: String,
      enum: ["initiated", "uploaded", "success", "failed"],
      default: "initiated",
    },
    fileUrl: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

export const FileModel =
  (mongoose.models.File as mongoose.Model<IFile>) ||
  mongoose.model<IFile>("File", FileSchema);

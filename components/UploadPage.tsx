/**
 * components/UploadPage.tsx
 *
 * Main upload UI component. Handles:
 *   - File selection with drag-and-drop
 *   - Resume detection (checks localStorage for existing session)
 *   - Network disconnect/reconnect detection
 *   - Upload start, pause on offline, resume on online
 *   - Cancel/abort with S3 cleanup
 *   - Real-time progress, speed, ETA metrics
 *   - Step-by-step pipeline visualization
 */

"use client";

import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from "react";
import ProgressBar from "./ProgressBar";
import UploadLogger from "./UploadLogger";
import { startUpload, resumeUpload, abortUpload } from "@/services/uploadService";
import { validateFile } from "@/utils/validation";
import { calcChunkSize, calcPartCount } from "@/utils/chunkCalculator";
import { calcConcurrency } from "@/utils/concurrencyManager";
import { createLogEntry, type LogEntry, type LogLevel } from "@/utils/uploadLogger";
import { findResumeSession, pruneExpiredSessions, type UploadSession } from "@/utils/uploadSession";

// ─── Types ────────────────────────────────────

type UploadStatus = "idle" | "starting" | "uploading" | "completing" | "done" | "error" | "paused";

const PIPELINE_STEPS = ["Selected", "Init", "Chunking", "Uploading", "Completing", "Done"];

// ─── Helpers ──────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function getFileIcon(type: string): string {
  if (type.startsWith("image/")) return "🖼";
  if (type.startsWith("video/")) return "🎬";
  if (type.startsWith("audio/")) return "🎵";
  if (type.includes("pdf")) return "📄";
  if (type.includes("zip") || type.includes("tar")) return "📦";
  return "📁";
}

// ─── Status badge ─────────────────────────────

function StatusBadge({ status }: { status: UploadStatus }) {
  const map: Record<UploadStatus, { label: string; cls: string }> = {
    idle:       { label: "Ready",      cls: "bg-gray-100 text-gray-500" },
    starting:   { label: "Starting",   cls: "bg-amber-100 text-amber-700" },
    uploading:  { label: "Uploading",  cls: "bg-blue-100 text-blue-700" },
    completing: { label: "Completing", cls: "bg-violet-100 text-violet-700" },
    done:       { label: "Complete",   cls: "bg-green-100 text-green-700" },
    error:      { label: "Failed",     cls: "bg-red-100 text-red-700" },
    paused:     { label: "Paused",     cls: "bg-yellow-100 text-yellow-700" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`text-xs font-bold uppercase tracking-widest px-2.5 py-1 rounded-full font-mono ${cls}`}>
      {label}
    </span>
  );
}

// ─── Main component ───────────────────────────

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [resumeSession, setResumeSession] = useState<UploadSession | null>(null);
  const [metrics, setMetrics] = useState({ speed: 0, eta: 0, elapsed: 0, loaded: 0 });
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);
  const pausedRef = useRef(false);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Network detection ────────────────────────
  useEffect(() => {
    pruneExpiredSessions();

    const handleOffline = () => {
      setIsOnline(false);
      pausedRef.current = true;
      setStatus((s) => (s === "uploading" ? "paused" : s));
      addLog("Network offline — upload paused", "warn");
    };

    const handleOnline = () => {
      setIsOnline(true);
      pausedRef.current = false;
      addLog("Network restored — you can resume the upload", "success");
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const addLog = useCallback((message: string, level: LogLevel = "info") => {
    setLogs((prev) => [...prev.slice(-49), createLogEntry(message, level)]);
  }, []);

  // ── File select ──────────────────────────────
  const handleFileSelect = useCallback((selected: File) => {
    abortRef.current = false;
    pausedRef.current = false;
    setValidationError(null);
    setFile(selected);
    setStatus("idle");
    setProgress(0);
    setLogs([]);
    setMetrics({ speed: 0, eta: 0, elapsed: 0, loaded: 0 });
    setCurrentFileId(null);

    // Check if there's a resumable session for this file
    const existing = findResumeSession(selected.name, selected.size);
    setResumeSession(existing);

    const chunkSize = calcChunkSize(selected.size);
    const parts = calcPartCount(selected.size);
    const concurrency = calcConcurrency(selected.size);

    addLog(`File selected: ${selected.name}`, "step");
    addLog(`Size: ${formatBytes(selected.size)} | Type: ${selected.type || "unknown"}`, "info");
    addLog(`Chunk: ${formatBytes(chunkSize)} → ${parts} parts`, "info");
    addLog(`Concurrency: ${concurrency}× (${navigator.hardwareConcurrency ?? "?"} CPU cores)`, "info");

    if (existing) {
      addLog(
        `Resumable session found — ${existing.uploadedPartNumbers.length}/${existing.presignedUrls.length} parts already uploaded`,
        "warn"
      );
    }
  }, [addLog]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0]);
  };

  // ── Upload helpers ───────────────────────────
  const startTimer = () => {
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => {
      setMetrics((m) => ({ ...m, elapsed: Date.now() - startTimeRef.current }));
    }, 500);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const callbacks = useCallback(() => ({
    onLog: addLog,
    onProgress: (loaded: number, total: number) => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const speed = loaded / elapsed;
      const eta = speed > 0 ? (total - loaded) / speed : 0;
      setProgress(Math.round((loaded / total) * 100));
      setMetrics({ speed, eta: eta * 1000, elapsed: elapsed * 1000, loaded });
    },
    onAbort: () => abortRef.current || pausedRef.current,
  }), [addLog]);

  // ── Start fresh upload ────────────────────────
  const handleStartUpload = async () => {
    if (!file) return;

    try {
      validateFile(file);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Invalid file");
      return;
    }

    abortRef.current = false;
    pausedRef.current = false;
    setStatus("starting");
    setProgress(0);
    setLogs([]);
    setValidationError(null);
    startTimer();

    addLog("Upload initialization started", "step");
    setStatus("uploading");

    try {
      const result = await startUpload(file, callbacks());
      setCurrentFileId(result.fileId);
      stopTimer();
      const elapsed = Date.now() - startTimeRef.current;
      setStatus("done");
      setProgress(100);
      setMetrics((m) => ({ ...m, speed: file.size / (elapsed / 1000), eta: 0, elapsed }));
      addLog(`Done in ${formatDuration(elapsed)} @ ${formatBytes(file.size / (elapsed / 1000))}/s`, "success");
      setResumeSession(null);
    } catch (err) {
      stopTimer();
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg === "Upload cancelled by user") {
        addLog("Upload cancelled", "warn");
        setStatus("idle");
      } else if (msg.includes("aborted") || pausedRef.current) {
        addLog("Upload paused — go online and click Resume", "warn");
        setStatus("paused");
      } else {
        addLog(`Error: ${msg}`, "error");
        setStatus("error");
      }
    }
  };

  // ── Resume upload ─────────────────────────────
  const handleResumeUpload = async () => {
    if (!file || !resumeSession) return;

    abortRef.current = false;
    pausedRef.current = false;
    setStatus("uploading");
    setValidationError(null);
    startTimer();

    addLog("Resuming upload…", "step");

    try {
      const result = await resumeUpload(file, resumeSession, callbacks());
      setCurrentFileId(result.fileId);
      stopTimer();
      const elapsed = Date.now() - startTimeRef.current;
      setStatus("done");
      setProgress(100);
      setMetrics((m) => ({ ...m, speed: file.size / (elapsed / 1000), eta: 0, elapsed }));
      addLog(`Resumed and completed in ${formatDuration(elapsed)}`, "success");
      setResumeSession(null);
    } catch (err) {
      stopTimer();
      addLog(`Resume error: ${err instanceof Error ? err.message : "Unknown"}`, "error");
      setStatus("error");
    }
  };

  // ── Cancel upload ─────────────────────────────
  const handleCancel = async () => {
    abortRef.current = true;
    stopTimer();
    if (currentFileId) {
      await abortUpload(currentFileId, { onLog: addLog, onProgress: () => {}, onAbort: () => false });
    }
    setStatus("idle");
    setProgress(0);
  };

  // ── Reset ─────────────────────────────────────
  const reset = () => {
    abortRef.current = true;
    stopTimer();
    setFile(null);
    setStatus("idle");
    setProgress(0);
    setLogs([]);
    setMetrics({ speed: 0, eta: 0, elapsed: 0, loaded: 0 });
    setCurrentFileId(null);
    setResumeSession(null);
    setValidationError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const isActive = status === "uploading" || status === "starting" || status === "completing";

  const activeStep = {
    idle: file ? 0 : -1,
    starting: 1,
    uploading: Math.min(2 + Math.floor((progress / 100) * 2), 3),
    completing: 4,
    done: 5,
    error: -1,
    paused: 3,
  }[status];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4 flex-wrap">
          <span className="bg-gray-900 text-white text-xs font-bold tracking-widest uppercase px-3 py-1 rounded-md font-mono">
            S3 Multipart
          </span>
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">File Upload</h1>
          {!isOnline && (
            <span className="ml-2 text-xs font-semibold text-yellow-700 bg-yellow-100 px-2.5 py-1 rounded-full">
              ⚠ Offline
            </span>
          )}
          <span className="ml-auto text-sm text-gray-400 hidden sm:block">
            Direct-to-S3 · Resumable · Zod Validated
          </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

          {/* ── LEFT COLUMN ── */}
          <div className="flex flex-col gap-4">

            {/* Drop Zone */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Select File</p>
              <div
                onClick={() => !isActive && fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                className={[
                  "rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-150 select-none",
                  isDragging ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:border-gray-400 hover:bg-gray-50",
                  file ? "border-solid border-gray-200 bg-white" : "",
                ].join(" ")}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    if (e.target.files?.[0]) handleFileSelect(e.target.files[0]);
                  }}
                  disabled={isActive}
                />
                {file ? (
                  <div className="flex items-center gap-3 text-left">
                    <span className="text-3xl shrink-0">{getFileIcon(file.type)}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{file.name}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{formatBytes(file.size)} · {file.type || "unknown"}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-3xl text-gray-300 mb-2">↑</p>
                    <p className="text-sm font-medium text-gray-600">Drop file or click to browse</p>
                    <p className="text-xs text-gray-400 mt-1">Any file type · Auto-chunked · Resumable</p>
                  </>
                )}
              </div>

              {/* Validation error */}
              {validationError && (
                <p className="mt-2 text-xs text-red-600 font-medium">{validationError}</p>
              )}

              {/* Resume banner */}
              {resumeSession && status === "idle" && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="text-xs font-semibold text-amber-800">
                    Resumable session found — {resumeSession.uploadedPartNumbers.length}/{resumeSession.presignedUrls.length} parts uploaded
                  </p>
                  <p className="text-xs text-amber-600 mt-0.5">
                    Click "Resume Upload" to continue from where you left off.
                  </p>
                </div>
              )}
            </div>

            {/* Upload Plan */}
            {file && (
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Upload Plan</p>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: "Chunk Size",   value: formatBytes(calcChunkSize(file.size)),    sub: "dynamic" },
                    { label: "Parts",         value: String(calcPartCount(file.size)),         sub: "≤ 10,000" },
                    { label: "Concurrency",   value: `${calcConcurrency(file.size)}×`,         sub: "parallel" },
                    { label: "File Size",     value: formatBytes(file.size),                   sub: "total" },
                  ].map((m) => (
                    <div key={m.label} className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-center">
                      <p className="text-sm font-bold text-gray-900 font-mono">{m.value}</p>
                      <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mt-1 leading-tight">{m.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{m.sub}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Progress */}
            {file && (
              <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Progress</p>
                  <StatusBadge status={status} />
                </div>

                <ProgressBar progress={progress} loaded={metrics.loaded} total={file.size} />

                {(isActive || status === "done" || status === "paused") && (
                  <div className="grid grid-cols-3 gap-2 pt-3 mt-2 border-t border-gray-100">
                    {[
                      { label: "Speed",   value: metrics.speed > 0 ? `${formatBytes(metrics.speed)}/s` : "—" },
                      { label: "ETA",     value: status === "done" ? "Done" : metrics.eta > 0 ? formatDuration(metrics.eta) : "—" },
                      { label: "Elapsed", value: metrics.elapsed > 0 ? formatDuration(metrics.elapsed) : "—" },
                    ].map((s) => (
                      <div key={s.label} className="text-center">
                        <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold">{s.label}</p>
                        <p className="text-sm font-bold text-gray-900 font-mono mt-0.5">{s.value}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 flex-wrap">
              {/* Start fresh */}
              {(!resumeSession || status !== "idle") && (
                <button
                  onClick={handleStartUpload}
                  disabled={!file || isActive || status === "done" || !isOnline}
                  className="flex-1 py-2.5 px-5 bg-gray-900 text-white text-sm font-semibold rounded-lg
                    transition-all duration-150 hover:bg-gray-700 hover:-translate-y-px hover:shadow-md
                    disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:shadow-none"
                >
                  {isActive ? "Uploading…" : status === "done" ? "✓ Complete" : "Start Upload"}
                </button>
              )}

              {/* Resume */}
              {resumeSession && status === "idle" && (
                <button
                  onClick={handleResumeUpload}
                  disabled={!isOnline}
                  className="flex-1 py-2.5 px-5 bg-amber-600 text-white text-sm font-semibold rounded-lg
                    transition-all duration-150 hover:bg-amber-700 hover:-translate-y-px hover:shadow-md
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Resume Upload
                </button>
              )}

              {/* Paused → Resume */}
              {status === "paused" && isOnline && (
                <button
                  onClick={handleResumeUpload}
                  className="flex-1 py-2.5 px-5 bg-amber-600 text-white text-sm font-semibold rounded-lg
                    transition-all duration-150 hover:bg-amber-700"
                >
                  Resume Upload
                </button>
              )}

              {/* Cancel active upload */}
              {isActive && (
                <button
                  onClick={handleCancel}
                  className="px-4 py-2.5 bg-white text-red-600 text-sm font-medium rounded-lg
                    border border-red-200 hover:bg-red-50 transition-all duration-150"
                >
                  Cancel
                </button>
              )}

              {/* Reset */}
              {file && !isActive && (
                <button
                  onClick={reset}
                  className="px-4 py-2.5 bg-white text-gray-600 text-sm font-medium rounded-lg
                    border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-all duration-150"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Result banners */}
            {status === "done" && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">✓ Upload successful</p>
                <p className="text-xs text-gray-500 font-mono mt-0.5">
                  S3 event → POST /api/webhook/s3-file → MongoDB: success
                </p>
              </div>
            )}
            {status === "error" && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">✗ Upload failed</p>
                <p className="text-xs text-gray-500 mt-0.5">Check the log console →</p>
              </div>
            )}
            {status === "paused" && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                <p className="text-sm font-semibold text-gray-900">⏸ Upload paused — offline</p>
                <p className="text-xs text-gray-500 mt-0.5">Your progress is saved. Reconnect to resume.</p>
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN ── */}
          <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">

            {/* Pipeline */}
            <div className="flex items-start">
              {PIPELINE_STEPS.map((step, i) => (
                <div key={step} className="flex flex-col items-center flex-1 relative">
                  {i < PIPELINE_STEPS.length - 1 && (
                    <div className={["absolute top-3 left-1/2 w-full h-px", i < activeStep ? "bg-gray-900" : "bg-gray-200"].join(" ")} />
                  )}
                  <div className={[
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold z-10 transition-all duration-200",
                    i < activeStep ? "bg-gray-900 text-white"
                    : i === activeStep ? "bg-white border-2 border-gray-900 text-gray-900"
                    : "bg-gray-100 border border-gray-200 text-gray-400",
                  ].join(" ")}>
                    {i < activeStep ? "✓" : i + 1}
                  </div>
                  <p className={[
                    "text-xs mt-1.5 text-center leading-tight",
                    i === activeStep ? "font-bold text-gray-900"
                    : i < activeStep ? "text-gray-500"
                    : "text-gray-300",
                  ].join(" ")}>
                    {step}
                  </p>
                </div>
              ))}
            </div>

            {/* Log console */}
            <UploadLogger logs={logs} isActive={isActive} />

            {/* API routes reference */}
            <div className="border-t border-gray-100 pt-3 grid grid-cols-2 gap-2">
              {[
                "/api/upload/start",
                "/api/upload/complete",
                "/api/upload/status",
                "/api/upload/abort",
                "/api/webhook/s3-file",
              ].map((route) => (
                <div key={route} className="bg-gray-50 rounded-md px-2 py-1.5 text-center">
                  <p className="text-xs font-mono text-gray-500 truncate">{route}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}

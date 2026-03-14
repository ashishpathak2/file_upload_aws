/**
 * components/UploadLogger.tsx
 * Real-time log console showing all upload events.
 */
"use client";

import { useEffect, useRef } from "react";
import type { LogEntry, LogLevel } from "@/utils/uploadLogger";

interface UploadLoggerProps {
  logs: LogEntry[];
  isActive: boolean;
}

function logBadgeClass(level: LogLevel): string {
  const map: Record<LogLevel, string> = {
    info:    "bg-gray-100 text-gray-500",
    success: "bg-green-100 text-green-700",
    error:   "bg-red-100 text-red-700",
    warn:    "bg-amber-100 text-amber-700",
    api:     "bg-blue-100 text-blue-700",
    step:    "bg-violet-100 text-violet-700",
  };
  return map[level];
}

function logBadgeLabel(level: LogLevel): string {
  const map: Record<LogLevel, string> = {
    info: "INFO", success: "OK", error: "ERR", warn: "WARN", api: "API", step: "STEP",
  };
  return map[level];
}

function logTextClass(level: LogLevel): string {
  const map: Record<LogLevel, string> = {
    info: "text-gray-600", success: "text-green-700", error: "text-red-700",
    warn: "text-amber-700", api: "text-blue-700", step: "text-violet-700",
  };
  return map[level];
}

export default function UploadLogger({ logs, isActive }: UploadLoggerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new log entries
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Upload Log</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 font-mono">{logs.length} entries</span>
          {isActive && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
        </div>
      </div>

      <div
        ref={containerRef}
        className="bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-y-auto min-h-48 max-h-96"
      >
        {logs.length === 0 ? (
          <p className="text-xs text-gray-400 font-mono italic text-center pt-10">
            Waiting for upload to start…
          </p>
        ) : (
          <div className="space-y-0.5">
            {logs.map((log) => (
              <div key={log.id} className="flex items-baseline gap-2 py-1 border-b border-gray-100 last:border-0">
                <span className="text-xs text-gray-400 font-mono shrink-0">{log.time}</span>
                <span className={`text-xs font-bold px-1.5 py-px rounded shrink-0 font-mono ${logBadgeClass(log.level)}`}>
                  {logBadgeLabel(log.level)}
                </span>
                <span className={`text-xs font-mono break-all ${logTextClass(log.level)}`}>
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

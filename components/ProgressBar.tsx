/**
 * components/ProgressBar.tsx
 * Animated progress bar with percentage and byte counters.
 */

interface ProgressBarProps {
  progress: number;
  loaded: number;
  total: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function ProgressBar({ progress, loaded, total }: ProgressBarProps) {
  return (
    <div className="space-y-1.5">
      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full bg-gray-900 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between">
        <span className="text-xs text-gray-400 font-mono">
          {formatBytes(loaded)} / {formatBytes(total)}
        </span>
        <span className="text-xs font-bold text-gray-900 font-mono">{progress}%</span>
      </div>
    </div>
  );
}

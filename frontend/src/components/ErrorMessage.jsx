import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function ErrorMessage({ message = 'Something went wrong', onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <div className="flex items-center gap-2 text-red-400">
        <AlertTriangle size={20} />
        <span className="text-sm font-medium">{message}</span>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary text-sm flex items-center gap-2">
          <RefreshCw size={14} />
          Retry
        </button>
      )}
    </div>
  );
}

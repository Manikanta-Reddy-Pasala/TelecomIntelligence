export default function LoadingSpinner({ size = 'md', text = 'Loading...' }) {
  const sizes = {
    sm: 'w-4 h-4 border',
    md: 'w-8 h-8 border-2',
    lg: 'w-12 h-12 border-2',
  };

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div
        className={`${sizes[size]} border-blue-500 border-t-transparent rounded-full animate-spin`}
      />
      {text && <span className="text-sm text-slate-500">{text}</span>}
    </div>
  );
}

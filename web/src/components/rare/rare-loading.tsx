export function RareLoading({ className = "" }: { className?: string }) {
  return <span aria-label="Loading" role="status" className={`rare-loading ${className}`} />;
}

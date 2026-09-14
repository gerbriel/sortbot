/**
 * The brand wordmark. The logo is the product name set in Outfit (medium
 * weight, tight tracking) — no icon. Styling lives in index.css (.wordmark);
 * callers pass a className for size/colour (e.g. the inverted nav).
 */
export default function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`wordmark ${className}`.trim()} aria-label="Arcadian">Arcadian</span>;
}

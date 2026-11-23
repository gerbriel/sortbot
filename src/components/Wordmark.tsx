import { BRAND } from '../brand';

/**
 * The brand wordmark. The logo is the product name (src/brand.ts) set in
 * Outfit (medium weight, --wordmark-tracking), no icon. Styling lives in
 * index.css (.wordmark); callers pass a className for size/colour (e.g. the inverted nav).
 */
export default function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`wordmark ${className}`.trim()} aria-label={BRAND}>{BRAND}</span>;
}

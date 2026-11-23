import { useBrand } from '../lib/brandStore';

/**
 * The brand wordmark. The logo is the product name (the runtime brand,
 * lib/brandStore, seeded from brand.json) set in Outfit (medium weight,
 * --wordmark-tracking), no icon. Styling lives in index.css (.wordmark);
 * callers pass a className for size/colour (e.g. the inverted nav). `name`
 * overrides the store, for the Founder console's preview of an unsaved name.
 */
export default function Wordmark({ className = '', name }: { className?: string; name?: string }) {
  const brand = useBrand();
  const text = name ?? brand.name;
  return <span className={`wordmark ${className}`.trim()} aria-label={text}>{text}</span>;
}

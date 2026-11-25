/**
 * Flipkart marketplace — types shared by the API (src/flipkart) and the web app
 * (components/flipkart). Imported as `@dash/shared/flipkart`.
 *
 * Flipkart reuses the quick-commerce metric engine (`Sums`, `METRICS`) from the
 * Blinkit module; only Flipkart-specific report types and API shapes live here.
 */
export * from './report-types';
export * from './api-types';
export { normKey } from '../blinkit/geo';
export type { Sums, MetricKey, MetricDef, Fmt } from '../blinkit/metrics';
export {
  METRICS,
  metricValue,
  blank,
  addInto,
  formatValue,
  fmtMetric,
  deltaPct,
} from '../blinkit/metrics';

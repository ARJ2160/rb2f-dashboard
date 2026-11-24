/**
 * Zepto marketplace — types and business rules shared by the API
 * (src/zepto) and the web app (components/zepto). Imported as
 * `@dash/shared/zepto`.
 *
 * Zepto reuses the quick-commerce metric engine (`Sums`, `METRICS`, geo helpers)
 * from the Blinkit module; only Zepto-specific report types and the ad-metric
 * mapping live here.
 */
export * from './report-types';
export * from './api-types';
export * from './geo';
export { normKey } from '../blinkit/geo';
export type { Sums, MetricKey, MetricDef, Fmt } from '../blinkit/metrics';
export { METRICS, metricValue, blank, addInto, formatValue, fmtMetric, deltaPct } from '../blinkit/metrics';

'use client';

import { METRICS, QC_FLAVOURS, type MetricKey, type QcFlavour, type QcMarket } from '@dash/shared/blinkit';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { qcApi, type QcApi } from '@/lib/blinkit-api';

/* Which quick-commerce marketplace the Blinkit-style views are rendering:
   its API client, the metrics it has, and its wording. Defaults to Blinkit,
   so a view used outside a provider behaves exactly as before. */

interface Qc {
  flavour: QcFlavour;
  api: QcApi;
}

const blinkit: Qc = { flavour: QC_FLAVOURS.blinkit, api: qcApi(QC_FLAVOURS.blinkit.apiBase) };
const Ctx = createContext<Qc>(blinkit);

export function QcProvider({ market, children }: { market: QcMarket; children: ReactNode }) {
  const value = useMemo<Qc>(() => (market === 'blinkit' ? blinkit : { flavour: QC_FLAVOURS[market], api: qcApi(QC_FLAVOURS[market].apiBase) }), [market]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQc() {
  const c = useContext(Ctx);
  return {
    ...c,
    /** false for metrics this marketplace's reports don't carry */
    show: (k: MetricKey) => !c.flavour.hidden.includes(k),
    /** metric label, with this marketplace's wording */
    label: (k: MetricKey) => c.flavour.labels[k] ?? METRICS[k].label,
  };
}

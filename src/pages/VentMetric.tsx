import type { ReactNode } from 'react';

export function VentMetric({ icon, label, children, detail }: { icon: ReactNode; label: string; children: ReactNode; detail: ReactNode }) {
  return <section className="vent-metric"><div className="vent-metric-label"><span aria-hidden="true">{icon}</span>{label}</div><strong>{children}</strong><div className="vent-detail">{detail}</div></section>;
}

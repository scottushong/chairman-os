import type { Kpi } from '@/lib/finance-overview/kpis'

/** ⑧ 12가지 지표 — 시안 그대로(왼쪽 굵은 띠: 초록 #0f6b5c · 주황 #d9a441 · 빨강 #b4432b · 자료 부족은 회색 점선). */
const EDGE: Record<Kpi['tone'], string> = { good: 'border-l-[#0f6b5c]', warn: 'border-l-[#d9a441]', bad: 'border-l-[#b4432b]', none: 'border-l-[#c9d1cd]' }

export function KpiGrid({ kpis, id, title = '⑧ 12가지 지표 — 한눈에 판단' }: { kpis: Kpi[]; id?: string; title?: string }) {
  return (
    <section id={id} className="flex flex-col gap-3 rounded-[10px] border border-[#e1e6e3] bg-white px-[18px] py-4" data-testid="kpi-grid">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-bold">{title}</h2>
        <div className="text-[14px] lg:text-[12px] text-[#6b7772]">초록 = 괜찮음 · 주황 = 살펴볼 것 · 빨강 = 조치 필요</div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.no} data-tone={k.tone} className={`flex min-w-0 flex-col gap-1 rounded-lg border border-l-4 border-[#e1e6e3] px-3 py-2.5 ${EDGE[k.tone]} ${k.need ? 'border-dashed' : ''}`}>
            <div className="text-[14px] lg:text-[12px] text-[#6b7772]">
              {k.no} {k.title}
            </div>
            <div className={`text-[18px] font-bold tnum ${k.need ? 'text-[#6b7772]' : ''}`}>
              {k.value}{' '}
              {k.aside ? <span className={`text-[14px] lg:text-[12px] ${k.asideTone === 'up' ? 'font-semibold text-[#0f6b5c]' : k.asideTone === 'down' ? 'font-semibold text-[#b4432b]' : 'font-medium text-[#6b7772]'}`}>{k.aside}</span> : null}
            </div>
            <div className="text-[14px] lg:text-[12px] text-[#6b7772]">{k.detail}</div>
            <div className="text-[14px] lg:text-[12px] text-[#1a211e]">
              → {k.question}: <b>{k.answer}</b>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

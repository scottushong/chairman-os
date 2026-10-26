'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { saveKpiSettings } from '@/app/actions/finance-upload'
import { KPI_SETTING_LABEL, type KpiSettings } from '@/lib/finance-overview/settings'

/** 12가지 지표 기준값(0085 fin_kpi_settings) — 대표 · CFO · 마감 권한자만 바꾼다(이유 필수 · 감사). 다른 사람은 읽기만. */
export function KpiSettingsPanel({ businessId, settings, canEdit }: { businessId: string; settings: KpiSettings; canEdit: boolean }) {
  const router = useRouter()
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, v === null ? '' : String(v)])))
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, start] = useTransition()
  const keys = Object.keys(KPI_SETTING_LABEL) as (keyof KpiSettings)[]
  return (
    <details className="rounded-[10px] border border-line bg-card px-[18px] py-3" data-testid="kpi-settings">
      <summary className="cursor-pointer text-[15px] font-bold">기준값 — 안전선 잔액 · 연체 기준일 · 목표 …{canEdit ? '' : ' (대표 · CFO · 마감 권한자만 바꿉니다)'}</summary>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {keys.map((k) => (
          <label key={k} className="flex flex-col gap-1 text-[14px] lg:text-[12px] text-ink-muted">
            {KPI_SETTING_LABEL[k]}
            <input
              inputMode="decimal"
              disabled={!canEdit}
              value={vals[k] ?? ''}
              placeholder={k === 'safety_cash' ? '비우면 한 달 평균 지출' : k === 'usd_krw' ? '비우면 공개 고시' : '비움 = 정하지 않음'}
              onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}
              className="min-h-11 lg:min-h-9 rounded-md border border-line bg-card px-2 text-[14px] text-ink tnum disabled:bg-raised"
            />
          </label>
        ))}
      </div>
      {canEdit ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="바꾸는 이유(필수)" className="min-h-11 lg:min-h-9 min-w-0 flex-1 rounded-md border border-line px-2 text-[14px]" />
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              start(async () => {
                const payload = Object.fromEntries(keys.map((k) => [k, vals[k] === '' ? null : Number(String(vals[k]).replace(/,/g, ''))]))
                const r = await saveKpiSettings(businessId, payload, reason)
                setMsg(r.error ?? '저장했습니다 — 지표를 다시 계산합니다.')
                if (r.ok) router.refresh()
              })
            }
            className="min-h-11 lg:min-h-9 rounded-lg bg-accent px-4 text-[14px] font-semibold text-on-accent disabled:opacity-50"
          >
            {busy ? '저장 중…' : '기준값 저장'}
          </button>
          {msg ? <span role="status" className="text-[13px] text-ink-muted">{msg}</span> : null}
        </div>
      ) : null}
    </details>
  )
}

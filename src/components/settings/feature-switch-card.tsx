'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { setFeatureSwitch } from '@/app/actions/features'
import { AUDIENCE_LABEL, FEATURE_AUDIENCES, type FeatureAudience } from '@/lib/features'

/** 한 범위(그룹 기본 또는 회사 하나)의 지금 값. */
export interface FeatureScopeRow {
  business_id: string | null
  label: string
  enabled: boolean
  audience: FeatureAudience
  reason: string
  /** «바꾼 사람 · 때» 한 줄. */
  changed: string
}

/**
 * /settings/features의 기능 한 장(0073). 위: 지금 값(그룹 기본 + 회사 덮어쓰기). 아래: 바꾸기 — 범위(그룹 · 회사) · 켜짐 · 보는 범위 · 이유(필수).
 * 판정은 0073 feature_switch_set(대표만 · 이유 · 감사)이다.
 */
export function FeatureSwitchCard({
  feature,
  scopes,
  companies,
  disabled,
}: {
  feature: { key: string; label: string; description: string; from: string; defaultAudience: FeatureAudience }
  scopes: FeatureScopeRow[]
  companies: { business_id: string; name: string }[]
  disabled: boolean
}) {
  const router = useRouter()
  const [busy, start] = useTransition()
  const group = scopes[0]
  const [business, setBusiness] = useState('')
  const [enabled, setEnabled] = useState(group.enabled)
  const [audience, setAudience] = useState<FeatureAudience>(group.audience)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // 범위를 고르면 그 범위의 지금 값(없으면 그룹 기본)으로 칸을 채운다.
  const pickScope = (id: string) => {
    setBusiness(id)
    const now = scopes.find((s) => (s.business_id ?? '') === id) ?? group
    setEnabled(now.enabled)
    setAudience(now.audience)
  }

  const save = () => {
    setError(null)
    setDone(false)
    start(async () => {
      const r = await setFeatureSwitch({ feature: feature.key, business, enabled, audience, reason })
      if (r.error) {
        setError(r.error)
        return
      }
      setReason('')
      setDone(true)
      router.refresh()
    })
  }

  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-t13 font-semibold text-ink">{feature.label}</h2>
        <span className="text-t10 text-ink-muted">
          {feature.key} · {feature.from} · 기본 {AUDIENCE_LABEL[feature.defaultAudience]}
        </span>
      </div>
      <p className="mt-1 text-t11h text-ink-muted">{feature.description}</p>

      <ul className="mt-3 space-y-1">
        {scopes.map((s) => (
          <li key={s.business_id ?? 'group'} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-t11h">
            <span className="min-w-20 font-medium text-ink">{s.label}</span>
            <span className={s.enabled ? 'text-accent' : 'text-critical'}>{s.enabled ? '켜짐' : '꺼짐'}</span>
            <span className="text-ink-dim">{AUDIENCE_LABEL[s.audience]}</span>
            <span className="text-ink-muted">{s.changed}</span>
            <span className="text-ink-muted">«{s.reason}»</span>
          </li>
        ))}
      </ul>

      <form
        className="mt-3 grid gap-2 border-t border-line-soft pt-3 sm:grid-cols-[auto_auto_auto_1fr_auto] sm:items-center"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <select
          aria-label="범위"
          value={business}
          onChange={(e) => pickScope(e.target.value)}
          disabled={disabled || busy}
          className="min-h-9 rounded-md border border-line bg-panel px-2 text-t12h text-ink"
        >
          <option value="">그룹 기본</option>
          {companies.map((c) => (
            <option key={c.business_id} value={c.business_id}>
              {c.name}만
            </option>
          ))}
        </select>
        <label className="flex min-h-9 items-center gap-1.5 text-t12h text-ink">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={disabled || busy} />
          켜기
        </label>
        <select
          aria-label="보는 범위"
          value={audience}
          onChange={(e) => setAudience(e.target.value as FeatureAudience)}
          disabled={disabled || busy}
          className="min-h-9 rounded-md border border-line bg-panel px-2 text-t12h text-ink"
        >
          {FEATURE_AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {AUDIENCE_LABEL[a]}
            </option>
          ))}
        </select>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder="바꾸는 이유(필수)"
          disabled={disabled || busy}
          className="min-h-9 w-full rounded-md border border-line bg-panel px-2 text-t12h text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled || busy || reason.trim().length < 2}
          className="min-h-9 rounded-md bg-accent px-3 text-t11h font-semibold text-on-accent disabled:opacity-50"
        >
          {busy ? '저장 중…' : '저장'}
        </button>
      </form>
      {error ? <p className="mt-1.5 text-t10h text-critical">{error}</p> : null}
      {done ? <p className="mt-1.5 text-t10h text-ink-muted">바꿨습니다.</p> : null}
    </section>
  )
}

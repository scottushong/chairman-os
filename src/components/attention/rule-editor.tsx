'use client'

import { useState } from 'react'

import { saveExceptionRule } from '@/app/actions/attention'
import { RULE_UNIT } from '@/lib/attention/brief'
import { windowMonths } from '@/lib/attention/rules'
import type { ExceptionRule } from '@/types'

/**
 * 규칙 한 줄의 **회장 편집** — /attention/rules. §18.
 *
 * ■ 단위를 어디에 두는지 — **B-3이 정한 갈림길이다** ■
 * 0035 2절이 «표에 단위 칸을 두지 않았다»고 적고 그 대가를 B-3에게 넘겼다:
 * *"회장이 '20'을 고칠 때 그것이 %인지 개월인지를 표가 말해 주지 않는다."*
 * **칸을 더하지 않고 코드의 `RULE_UNIT`에서 읽어 입력 칸 옆에 붙였다.** 이유 셋:
 *   ① 그 표(`lib/attention/brief.ts`)는 **이미 있고 이미 쓰인다** — 브리핑 문장이 같은
 *      꼬리표를 쓴다. 칸을 더하면 단위가 두 벌이 되고, 규칙 13종은 **고정 사전**이라
 *      단위는 규칙 하나에 붙은 사실이지 회장이 고칠 값이 아니다.
 *   ② 칸을 더하려면 마이그레이션이 필요하고, 0035는 아직 staging에 적용되지 않았지만
 *      그 파일을 또 고치는 것보다 **앞으로 나아가며** 정하는 쪽이 이 저장소의 규율이다.
 *   ③ **모르는 단위는 지어내지 않는다.** `RULE_UNIT`에 없는 규칙에는 «단위 미표기»라고
 *      적는다 — 회장이 새 수치 규칙을 넣는 날 그 자리가 조용히 «%»가 되지 않는다.
 * 버린 선택지: `exception_rules.unit` 칸(회장이 단위까지 고칠 수 있게). 그러면 단위와
 * 잴 식이 어긋날 수 있다 — 식은 `rule_key`에 걸려 있고 단위는 칸에 있게 되므로.
 * DEFERRED에 한 줄 남겼다.
 *
 * ■ 수동 규칙에는 임계 칸이 **없다** ■ 빈 입력 칸을 그리지 않고 «수동 플래그 규칙»이라고
 * 적는다. 빈 칸을 그리면 회장에게 «채우라»고 말하는 것이 되고, 채우면 0035의
 * `kind_shape_check`가 그 줄을 거절한다(그 거절이 옳다 — 수동 규칙에 임계는 없는 것이다).
 *
 * ■ 권한 ■ 쓰기는 Chairman뿐이다(0035 `exception_rules_write`). 이 컴포넌트는 역할을 보지
 * 않고, 부모가 못 쓰는 사람에게는 **표만** 그린다 — 눌러도 거부당하는 버튼을 두지 않는다.
 */
export function RuleEditor({ rule }: { rule: ExceptionRule }) {
  const [threshold, setThreshold] = useState(
    rule.threshold === null ? '' : String(rule.threshold),
  )
  const [windowDays, setWindowDays] = useState(
    rule.window_days === null ? '' : String(rule.window_days),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const unit = RULE_UNIT[rule.rule_key] ?? null

  async function toggle() {
    setBusy(true)
    setError(null)
    setSaved(false)
    const result = await saveExceptionRule({
      ruleKey: rule.rule_key,
      kind: rule.kind,
      enabled: !rule.enabled,
    })
    setBusy(false)
    if (result.error) setError(result.error)
    else setSaved(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    const result = await saveExceptionRule({
      ruleKey: rule.rule_key,
      kind: rule.kind,
      threshold,
      windowDays,
    })
    setBusy(false)
    if (result.error) setError(result.error)
    else setSaved(true)
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={toggle}
          className="rounded-md border border-line px-2 py-1 text-[10.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
        >
          {rule.enabled ? '끄기' : '켜기'}
        </button>

        {rule.kind === 'manual' ? (
          // 빈 칸이 아니라 사실을 적는다.
          <span className="text-[10.5px] text-ink-muted">
            수동 플래그 규칙 — 임계도 창도 없습니다(사람이 세웁니다)
          </span>
        ) : (
          <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] text-ink-dim">
              임계 {unit ? `(${unit})` : '(단위 미표기)'}
              <input
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                inputMode="decimal"
                className="mt-0.5 block w-[86px] rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-ink outline-none focus:border-accent tnum"
              />
            </label>
            <label className="text-[10px] text-ink-dim">
              창 (일)
              <input
                value={windowDays}
                onChange={(e) => setWindowDays(e.target.value)}
                inputMode="numeric"
                className="mt-0.5 block w-[72px] rounded-md border border-line bg-panel px-2 py-1 text-[11.5px] text-ink outline-none focus:border-accent tnum"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-app disabled:opacity-40"
            >
              {busy ? '저장 중…' : '저장'}
            </button>
          </form>
        )}
      </div>

      {/*
       * 임계 0의 경고. **막지 않고 적는다** — 0035가 임계에 범위 제약을 일부러 걸지 않았고
       * (걸면 회장의 편집을 스키마가 막는다), 앱에서 새로 막으면 그 판정이 앱에만 있는
       * 두 번째 규칙이 된다. 대신 그 대가를 말한다: 임계가 0이면 «임계를 얼마나 넘어섰나»의
       * 비율이 서지 않아 `financialImpactAxis()`가 null을 돌려주고, 그 규칙의 예외는 그 뒤로
       * **등급을 받지 못한다**(score.ts의 `AXES_WITH_PLANNED_SOURCE` 주석이 그 자리다).
       */}
      {rule.kind === 'metric' && Number(threshold) === 0 && threshold !== '' ? (
        <p className="text-[10px] leading-relaxed text-warning">
          임계를 0으로 두면 «임계를 얼마나 넘어섰나»를 셀 수 없어 이 규칙의 예외는 그 뒤로
          등급이 나오지 않습니다(재무 축의 출처가 사라집니다). 저장은 됩니다.
        </p>
      ) : null}

      {/*
       * 창의 실제 눈금. `finance_kpis`의 눈금이 **달**이라 30일은 한 달, 90일은 분기다
       * (`windowMonths`). 그 접힘을 화면이 말하지 않으면 회장이 «45일»을 넣고 45일로 재고
       * 있다고 믿는다 — 계산은 엔진의 함수를 그대로 부른다(여기서 다시 나누지 않는다).
       */}
      {rule.kind === 'metric' && windowDays !== '' && Number(windowDays) > 0 ? (
        <p className="text-[10px] leading-relaxed text-ink-muted">
          이 창은 실제로 <b>{windowMonths(Number(windowDays))}개월</b>로 접혀 재어집니다 —
          수치 표(finance_kpis)의 눈금이 달이고, 이 저장소에 일별 수치가 없습니다.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[10.5px] leading-relaxed text-critical">
          {error}
        </p>
      ) : null}
      {saved ? <p className="text-[10.5px] text-ink-dim">저장했습니다.</p> : null}
    </div>
  )
}

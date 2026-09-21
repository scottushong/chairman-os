import Link from 'next/link'

import { Icon, type IconName } from '@/components/ui/icon'
import { DEPENDENCY_TARGET } from '@/lib/dependency'
import {
  AUTONOMY_LEVEL,
  AUTONOMY_EMPTY_KO,
  DEPENDENCY_LEVEL_LABEL_KO,
  TRANSFER_STATUS_LABEL_KO,
  type AutonomyLevel,
  type DependencyLevel,
  type TransferStatus,
} from '@/types'

/**
 * 의존 화면의 공통 조각. 세 화면과 대시보드 카드가 같은 모양으로 빈 칸을 말하게 한다.
 *
 * ■ 색 규칙(문서 §32) ■ "Color should indicate exceptions, not decoration."
 * 여기서 색이 붙는 자리는 **셋뿐**이다:
 *   ① 의존도가 목표(10%)를 넘는 수치 — 넘는 것 자체가 예외다
 *   ② 의존도 HIGH인 영역
 *   ③ 부재 테스트 실패
 * 나머지는 전부 ink 계열이다. '이양 완료'에 초록을 칠하고 싶어지지만 칠하지 않는다 —
 * 완료는 정상이고, 정상에 색을 칠하면 예외가 묻힌다.
 *
 * ■ 빈 칸 ■ Missing은 '없다'를 말하는 유일한 조각이다. 숫자 자리에 '—'만 찍고 넘어가면
 * 0%와 구별되지 않아서, 이유를 반드시 같이 받는다.
 */

/** 큰 숫자 하나. value가 null이면 숫자를 그리지 않고 이유를 적는다. */
export function BigPercent({
  value,
  reason,
}: {
  value: number | null
  /** value가 null일 때 그 자리에 적을 문장. 한 줄이어야 한다. */
  reason: string
}) {
  if (value === null) {
    return (
      <div>
        <p className="text-[28px] font-bold leading-none text-ink-muted tnum">—</p>
        <p className="mt-1.5 max-w-[360px] text-[11px] leading-relaxed text-ink-dim">{reason}</p>
      </div>
    )
  }
  const over = value > DEPENDENCY_TARGET
  return (
    <p className={`text-[44px] font-bold leading-none tnum ${over ? 'text-critical' : 'text-ink'}`}>
      {value}
      <span className="ml-0.5 text-[20px] font-semibold">%</span>
    </p>
  )
}

/** 표 한 칸의 백분율. 목표를 넘으면 그때만 색이 붙는다. */
export function Percent({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-muted">—</span>
  return (
    <span className={`tnum font-semibold ${value > DEPENDENCY_TARGET ? 'text-critical' : 'text-ink'}`}>
      {value}%
    </span>
  )
}

/**
 * §9 자율성 게이지 L1~L5. 평가가 없으면 **칸을 하나도 칠하지 않고** 그 사실을 적는다.
 * L1을 기본값으로 칠하면 "가장 낮은 등급으로 평가됐다"가 되어, 없는 평가가 생긴다.
 */
export function AutonomyGauge({ level }: { level: AutonomyLevel | null }) {
  return (
    <div>
      <div className="flex items-center gap-1" role="img" aria-label={level ? `자율성 ${level}` : AUTONOMY_EMPTY_KO}>
        {AUTONOMY_LEVEL.map((l) => {
          const on = level !== null && Number(l.slice(1)) <= Number(level.slice(1))
          return (
            <span
              key={l}
              className={`h-1.5 w-8 rounded-full ${on ? 'bg-ink' : 'bg-raised'}`}
              aria-hidden
            />
          )
        })}
        <span className="ml-1.5 text-[12px] font-semibold text-ink tnum">{level ?? ''}</span>
      </div>
      {level === null ? (
        <p className="mt-1 text-[11px] text-ink-dim">{AUTONOMY_EMPTY_KO}</p>
      ) : null}
    </div>
  )
}

/** 의존도 등급 칩. HIGH만 색이 붙는다 — 그것이 예외다. */
export function LevelChip({ level }: { level: DependencyLevel | null }) {
  if (level === null) return <span className="text-[11px] text-ink-muted">—</span>
  const tone =
    level === 'HIGH' ? 'bg-critical/15 text-critical' : 'bg-raised text-ink-dim'
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10.5px] ${tone}`}>
      {DEPENDENCY_LEVEL_LABEL_KO[level]}
    </span>
  )
}

/** 이양 상태 칩. 색 없이 글자만이다 — 이양은 정상 과정이지 예외가 아니다. */
export function TransferChip({ status }: { status: TransferStatus | null }) {
  if (status === null) return <span className="text-[11px] text-ink-muted">—</span>
  return (
    <span className="rounded bg-raised px-1.5 py-0.5 text-[10.5px] text-ink-dim">
      {TRANSFER_STATUS_LABEL_KO[status]}
    </span>
  )
}

/**
 * 없는 것을 말하는 자리. **이유 없이는 쓰지 않는다** — 이 블록에서 빈 칸은
 * '0'이 아니라 '아직 모른다'이고, 그 둘은 화면에서 전혀 다른 말이다.
 */
export function Missing({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-raised px-3 py-2.5 text-[11px] leading-relaxed text-ink-muted">{children}</p>
}

export function Section({
  icon,
  title,
  note,
  children,
}: {
  icon: IconName
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-3.5 rounded-xl border border-line-soft bg-panel p-3.5">
      <h2 className="mb-2 flex flex-wrap items-baseline gap-1.5 text-[13px] font-semibold">
        <Icon name={icon} className="size-4 text-ink-dim" />
        {title}
        {note ? (
          <span className="rounded bg-raised px-1.5 py-0.5 text-[9.5px] font-normal text-ink-dim">
            {note}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  )
}

/** 회사 한 곳으로 들어가는 링크. 목록과 카드가 같은 모양을 쓴다. */
export function CompanyLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href={`/dependency/${id}`}
      className="font-semibold text-ink underline-offset-2 hover:underline"
    >
      {name}
    </Link>
  )
}

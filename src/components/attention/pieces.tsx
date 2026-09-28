import { Icon } from '@/components/ui/icon'
import type { AttentionRow } from '@/lib/attention/screen'
import {
  AI_ANALYSIS_EMPTY_KO,
  AI_NOT_A_DECISION_KO,
  ATTENTION_LEVEL_LABEL_KO,
  CEO_HANDLING_UNKNOWN_KO,
  EXCEPTION_BLIND_KO,
  EXCEPTION_STATUS_LABEL_KO,
  type AttentionLevel,
  type ExceptionStatus,
} from '@/types'

/**
 * 주의 화면 셋이 같이 쓰는 조각 — Phase 7 블록 B-3.
 *
 * 세 화면(대시보드 카드 · /attention · /attention/rules)이 **같은 조각으로** 같은 사실을
 * 말하게 한다. 조각을 화면마다 따로 쓰면 어느 화면에서 라벨 하나가 빠지고, 빠진 그 화면이
 * 회장이 아침에 실제로 보는 화면일 수 있다. 블록 A의 `components/dependency/pieces.tsx`가
 * 같은 자리에 있다.
 *
 * ■ 색 규칙(문서 §32) ■ *"Color should indicate exceptions, not decoration."*
 * 색이 붙는 자리는 **등급 칩 하나**다. RED는 critical, YELLOW는 warning, GREEN은 색 없이
 * 글자만이다 — GREEN은 «CEO가 처리한다»이고 정상에 색을 칠하면 예외가 묻힌다.
 * 점수·축·이력·상태에는 색이 없다.
 *
 * ■ 이 파일이 지키는 것 둘 ■
 *   ① **«결정 아님»은 상수이고 끌 수 없다**(`AiAnalysis`). prop이 없다.
 *   ② **등급은 `scoreNote` 문자열로만 나온다**(`ScoreLevel`). 등급만 꺼내 그릴 자리가 없다.
 */

/* ------------------------------------------------------------------ 등급과 축 (거짓 ③) */

/**
 * `exceptions.severity` — **화면이 색을 고를 때 읽는 유일한 칸**이다(0035의 그 칸 주석).
 * `attention_scores.level`이 아니다. 둘이 갈릴 수 있고, 그때 맞는 색은 이쪽이다.
 */
export function SeverityChip({ level }: { level: AttentionLevel }) {
  const tone =
    level === 'RED'
      ? 'bg-critical/20 text-critical'
      : level === 'YELLOW'
        ? 'bg-warning/20 text-warning'
        : 'bg-raised text-ink-dim'
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-t9h font-bold tracking-wide ${tone}`}>
      {level} · {ATTENTION_LEVEL_LABEL_KO[level]}
    </span>
  )
}

/**
 * §19 점수와 **빈 축의 수**. 문장은 `lib/attention/screen.ts`의 `scoreNote()`가 만들고
 * 여기서는 그리기만 한다 — **화면이 등급을 따로 꺼내 쓸 칸이 없다는 것이 요점이다.**
 *
 * `score.ts`가 B-3에게 남긴 요구가 이것이다: *"화면은 등급 옆에 그 숫자를 반드시 적는다."*
 * 축 셋이 닿는 가중치는 100 중 45이고, 그 둘을 떼면 45의 근거가 100의 근거인 척한다.
 * 오늘은 출처가 있는 축이 하나라 **대부분의 예외에서 `level`이 null**이고, 그 자리는
 * «등급 미산출»이다 — **«GREEN»이 아니다.**
 */
export function ScoreLevel({ row }: { row: AttentionRow }) {
  return (
    <span
      data-score-note
      className="inline-flex items-baseline gap-1 text-t10h leading-relaxed text-ink-muted tnum"
    >
      <Icon name="target" className="size-3 shrink-0 translate-y-0.5" />
      {row.scoreNote}
    </span>
  )
}

/* ------------------------------------------------------------------ AI 분석 (거짓 ④) */

/**
 * `exceptions.ai_analysis`를 보이는 **유일한** 조각.
 *
 * ■ «결정 아님» 라벨은 상수이고 prop으로 끌 수 없다 ■ 이 컴포넌트가 받는 것은 글 하나뿐이고
 * 라벨을 숨기는 인자가 **없다.** §19: *"AI가 CEO를 대신하지 않는다. AI는 Chairman에게
 * «어디를 볼 것인가»를 알려준다."* 0035 4절이 «화면의 «결정 아님» 라벨이 이 칸에서 나온다»고
 * 적었고, 라벨을 열어 두면 «이 자리는 좁아서 안 넣는다»가 한 번 일어나며 그 화면에서 회장은
 * 모델의 문장을 판정으로 읽는다.
 *
 * 분석이 없으면 그 사실을 적는다 — **분석이 없다고 감지를 버리지 않는다**(stage.ts ②).
 * 그때는 보일 모델 문장이 없으므로 라벨도 없다(끈 것이 아니라 **대상이 없다**).
 */
export function AiAnalysis({ analysis }: { analysis: string | null }) {
  if (analysis === null) {
    return (
      <p className="text-t10h leading-relaxed text-ink-muted">
        <Icon name="sparkles" className="mr-1 inline size-3 -translate-y-px" />
        {AI_ANALYSIS_EMPTY_KO}
      </p>
    )
  }
  return (
    <div className="space-y-0.5">
      <p className="flex flex-wrap items-baseline gap-1.5 text-t10 text-ink-muted">
        <Icon name="sparkles" className="size-3 shrink-0 translate-y-0.5 text-gold" />
        AI 분석
        {/* 상수다. 이 자리를 prop으로 만들지 않는다. */}
        <span
          data-ai-not-a-decision
          className="rounded bg-raised px-1.5 py-0.5 text-t9h font-bold text-ink-dim"
        >
          {AI_NOT_A_DECISION_KO}
        </span>
      </p>
      {analysis.split('\n').map((line, i) => (
        <p key={i} className="text-t11 leading-relaxed text-ink-dim">
          {line}
        </p>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ 못 보는 것 (거짓 ①) */

/**
 * 읽기 집합 밖 계정이 보는 문장. **«0건»도 «정상»도 적지 않는다.**
 * `exceptions_read`가 좁아서 TeamLead·Member에게는 0행이고, 그 0은 «주의가 없다»가 아니라
 * «이 계정으로는 셀 수 없다»다. 블록 A가 `interventions`에서 같은 자리를 같은 모양으로 처리했다.
 */
export function BlindNote() {
  return (
    <p
      data-attention-blind
      className="flex items-baseline gap-1.5 text-t11 leading-relaxed text-ink-muted"
    >
      <Icon name="shield" className="size-3.5 shrink-0 translate-y-0.5" />
      {EXCEPTION_BLIND_KO}
    </p>
  )
}

/* ------------------------------------------------------------------ 상태 · CEO 대응 */

export function StatusChip({ status, until }: { status: ExceptionStatus; until: string | null }) {
  return (
    <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-t9h text-ink-dim tnum">
      {EXCEPTION_STATUS_LABEL_KO[status]}
      {/* 관찰에는 «언제까지»가 반드시 있다(0035의 check). 그 날짜를 같이 적는다 —
          기한을 안 보여 주면 화면에서 관찰과 «조용히 잊기»가 구별되지 않는다. */}
      {status === 'monitoring' && until ? ` · ${until.slice(0, 10)}까지` : null}
    </span>
  )
}

/**
 * `ceo_handling`. **false는 «CEO가 손 놓고 있다»가 아니다** — 야간 Job이 그 칸의 근거를
 * 읽을 표가 하나도 없다(stage.ts가 «그 차이는 화면이 적는다(B-3)»고 남긴 자리).
 * 회장이 «CEO에게 위임»을 누르면 true가 되고, 그때는 근거가 있는 true다.
 */
export function CeoHandling({ handling }: { handling: boolean }) {
  return (
    <span className="text-t10h text-ink-muted">
      {handling ? 'CEO 대응 중' : CEO_HANDLING_UNKNOWN_KO}
    </span>
  )
}

/** 잰 값과 임계. 수동 규칙에서는 **없다** — 0으로 적지 않는다. */
export function Measured({ row }: { row: AttentionRow }) {
  if (row.measured === null) {
    return (
      <span className="text-t10h text-ink-muted">
        잰 값 없음 — {row.rule?.kind === 'manual' ? '사람이 세운 수동 플래그' : '수치가 실리지 않음'}
      </span>
    )
  }
  return <span className="text-t11 text-ink tnum">{row.measured}</span>
}

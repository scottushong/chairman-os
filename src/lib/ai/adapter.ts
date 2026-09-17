import type { AiBriefItem, BusinessStatus, IsoDate } from '@/types'

/**
 * AI Adapter — 야간 Job과 모델 사이의 유일한 계약(Port).
 *
 * repository와 같은 이유로 인터페이스를 먼저 둔다. Job은 뒤에 어느 회사의 어느 모델이 있는지
 * 알 필요가 없고, 테스트나 모델 교체 때 이 두 함수만 맞추면 된다.
 *
 * 입력은 이미 RLS를 통과해 읽힌 값이다. 어댑터가 DB를 직접 읽지 않는다 —
 * 읽는 자리가 둘이 되면 Agent가 무엇을 볼 수 있는지 판정하는 자리도 둘이 된다.
 */

/** 모델 출력의 모양. Structured Outputs로 강제하고 brief-schema.ts가 한 번 더 검사한다. */
export interface AiBrief {
  summary: string
  /** 0~1. 모델이 스스로 매긴 값이다 — 0.7 미만은 화면이 흐리게 그린다(ai-night-panel). */
  confidence: number
  items: AiBriefItem[]
}

/** 회사 하나의 하루치 상태. 금액은 lib/format.ts로 억 단위 문자열까지 만들어 넘긴다. */
export interface CompanyContext {
  date: IsoDate
  business: { business_id: string; name: string; industry: string; status: BusinessStatus }
  kpis: { metric: string; period: string; value: string; target: string | null }[]
  decisions: { decision_id: string; title: string; impact: string; deadline: string; status: string }[]
  alerts: { alert_id: string; category: string; severity: string; status: string; message: string }[]
  tasks: {
    task_id: string
    title: string
    status: string
    priority: string
    deadline: string | null
    blocked_since: string
    chairman_needed: boolean
  }[]
  projects: { project_id: string; name: string; status: string; progress_pct: number; deadline: string | null }[]
}

export interface DailyBriefInput {
  date: IsoDate
  companies: { business_id: string; name: string; brief: AiBrief }[]
  /** 요약에 실패한 회사. 그룹 브리핑이 '다섯 곳 다 괜찮다'고 말하지 않게 같이 넘긴다. */
  failed: { business_id: string; name: string }[]
}

export interface AiAdapter {
  /** 어느 모델이 썼는지. ai_night_outputs.model 에 남는다. */
  readonly model: string
  summarizeCompany(input: CompanyContext): Promise<AiBrief>
  generateDailyBrief(input: DailyBriefInput): Promise<AiBrief>
}

/**
 * «시스템 보완함» 지시문의 고정 모양(0069) — 이 저장소의 블록 지시 형식. triage.ts(서버 · AI 호출)와 dummy 시드가 같이 쓴다
 * (그래서 server-only가 아닌 따로 된 파일이다). 고정 글에는 민감 낱말을 쓰지 않는다 — DB가 지시문 전체를 재서 거부한다.
 */
const REPORT_RULES = [
  '■ 보고 작성 규칙 (모든 보고)',
  '- 주어를 꼭 쓴다. 웹 화면은 정확한 URL(https://chairman-os-eosin.vercel.app/...), 파일은 전체 경로(C:\\Users\\Edison Hong\\projects\\...).',
  '- 보고 끝에 «회장이 할 일» 표. 명령 · 주소 · SQL은 한 상자에 하나(&& 금지). merge에는 -m.',
  '- 최종 보고는 짧게 먼저, 자세한 것은 docs/reports/ 아래 파일로.',
]

const COMMON_RULES = [
  '■ 공통 규칙',
  '- production 쓰기 · git push 금지. 비밀값 · 돈 드는 것 · 되돌릴 수 없는 삭제 금지. service_role 금지. 다른 세션 금지.',
  // 이 고정 글에는 민감 낱말(0069 ai_feedback_sensitive — 원가 · 단가 · 배합 · BOM …)을 쓰지 않는다: DB가 지시문 전체를 재서 거부한다.
  '- 제품 구성 비율 · 가격 산정 숫자는 어떤 AI 경로에도 싣지 않는다(check:cost-engine 코드 경계 유지). 직원 화면 «회장» 금지(«대표»). 새 정책은 to authenticated.',
  '- DB 마이그레이션 · RLS는 리뷰 루프. 화면은 typecheck · lint · 스크린샷.',
  '- 이 지시문은 사용자 의견에서 AI가 만든 초안이다 — «회장 확인 필요» 줄은 회장이 정하기 전에는 하지 않는다.',
]

export interface Draft {
  summary: string
  expected: string
  situation: string[]
  decisions: string[]
  steps: string[]
  final_report: string
  title?: string
}

export const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    expected: { type: 'string' },
    situation: { type: 'array', items: { type: 'string' } },
    decisions: { type: 'array', items: { type: 'string' } },
    steps: { type: 'array', items: { type: 'string' } },
    final_report: { type: 'string' },
    title: { type: 'string' },
  },
  required: ['summary', 'expected', 'situation', 'decisions', 'steps', 'final_report'],
  additionalProperties: false,
} as const

/** 지울 수 있는 민감한 글 — 키 · 토큰 · 이메일 · 전화 · 주민 · 긴 비밀 모양. */
export function scrub(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{10,}/g, '[지움]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.-]+/g, '[지움]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[이메일 지움]')
    .replace(/\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, '[전화 지움]')
    .replace(/\b0\d{1,2}[-\s.]\d{3,4}[-\s.]\d{4}\b/g, '[전화 지움]')
    .replace(/\b\d{6}-?[1-4]\d{6}\b/g, '[번호 지움]')
    .replace(/\b(?=[A-Za-z0-9+/]*\d)(?=[A-Za-z0-9+/]*[A-Za-z])[A-Za-z0-9+/]{40,}={0,2}/g, '[지움]')
}

export const line = (s: unknown, max = 400) => scrub(String(s ?? '').replace(/\s+/g, ' ').trim()).slice(0, max)
export const lines = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => line(x)).filter(Boolean).slice(0, n) : [])

/** 모델의 재료 → 이 저장소의 지시문(블록 지시 형식). 결정 줄은 늘 «(회장 확인 필요)». */
export function buildInstruction(d: Draft, head: string): string {
  const decisions = d.decisions.map((x, i) => `${i + 1}. ${x.replace(/\s*\(회장 확인 필요\)\s*$/, '')} (회장 확인 필요)`)
  return [
    `[블록 지시 — ${head}]`,
    '',
    '■ 현황',
    ...d.situation.map((x) => `- ${x.replace(/^-\s*/, '')}`),
    '',
    '■ 회장 결정 (아래는 AI 초안 — 회장 확인 필요)',
    ...decisions,
    '',
    ...REPORT_RULES,
    '',
    ...COMMON_RULES,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ...d.steps.map((x, i) => `${i + 1}. ${x.replace(/^\d+[.)]\s*/, '')}`),
    '',
    '최종 보고',
    `- ${d.final_report}`,
  ].join('\n')
}


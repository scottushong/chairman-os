import 'server-only'

import { submitApprovalForm } from '@/app/actions/approval-form'
import { summarizeAttachmentAction } from '@/app/actions/attachments'
import { saveCheckin } from '@/app/actions/checkin'
import { draftDecision } from '@/app/actions/draft-decision'
import { saveEventAction, saveInitiativeField, saveInitiativeNoteAction } from '@/app/actions/initiatives'
import type { AiAction } from '@/types'

/**
 * 확인된 제안 하나를 실행한다. **이 파일을 import하는 곳은 확인 버튼의 서버 액션 하나뿐이다**
 * (app/actions/assistant.ts confirmAiAction) — 모델의 도구 고리(run.ts · tools-*.ts)는 이것을 모른다.
 *
 * 받는 것은 ai_action_decide()가 방금 pending → confirmed로 넘기며 **돌려준 줄**이다. 화면이 보낸 값이 아니다.
 * 실행은 화면이 쓰던 기존 쓰기 문 그대로다 — 같은 입력 검사, 같은 세션(그 사람의 RLS), 같은 감사.
 * 그래서 AI 제안이라고 권한이 넓어지는 자리가 없다: 사람이 손으로 못 하는 쓰기는 확인해도 거부된다.
 */
export async function executeAiAction(action: AiAction): Promise<{ ok: boolean; message: string; href?: string }> {
  const p = action.payload
  const s = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '')
  switch (action.kind) {
    case 'initiative_update': {
      const id = s('initiative_id')
      const changes = (p.changes && typeof p.changes === 'object' ? p.changes : {}) as Record<string, unknown>
      // 칸 하나씩 — 화면의 인라인 편집과 같은 문이라 감사도 칸마다 before/after로 남는다.
      for (const [field, value] of Object.entries(changes)) {
        const r = await saveInitiativeField(id, field, value)
        if (r.error) return { ok: false, message: r.error }
      }
      return { ok: true, message: `${Object.keys(changes).length}칸을 저장했습니다.`, href: `/initiatives/${id}` }
    }
    case 'event_create': {
      const r = await saveEventAction(p)
      return r.error ? { ok: false, message: r.error } : { ok: true, message: '일정을 넣었습니다.', href: '/calendar' }
    }
    case 'approval_draft': {
      // 양식 결재(propose_approval_form) — 화면의 «결재 올리기»와 같은 서버 액션. 0038 · 0042 트리거가 결재선을 세운다.
      if (s('template_key')) {
        const r = await submitApprovalForm({
          templateKey: p.template_key,
          businessId: p.business_id,
          title: p.title,
          deadline: p.deadline,
          form: p.form,
        })
        return r.error || !r.decisionId
          ? { ok: false, message: r.error ?? '올리지 못했습니다.' }
          : { ok: true, message: `결재를 올렸습니다(${r.decisionId}) — ${r.state ?? '진행 중'}. 파일은 결재 화면에서 이 건의 «첨부» 칸에 붙이세요.`, href: `/approvals?id=${r.decisionId}` }
      }
      // 선택안 결재(회장 전용 propose_approval_draft).
      const r = await draftDecision({
        title: p.title,
        businessId: p.business_id,
        options: Array.isArray(p.options) ? (p.options as string[]).join('\n') : '',
        impact: p.impact,
        deadline: p.deadline,
        attachmentUrl: '',
      })
      return r.error || !r.decision
        ? { ok: false, message: r.error ?? '올리지 못했습니다.' }
        : { ok: true, message: `결재를 올렸습니다(${r.decision.decision_id}).`, href: `/approvals?id=${r.decision.decision_id}` }
    }
    case 'checkin': {
      const r = await saveCheckin({
        checkinDate: p.checkinDate,
        condition: p.condition,
        sleepHours: p.sleepHours,
        weightKg: p.weightKg,
        mealNote: p.mealNote,
      })
      return r.error ? { ok: false, message: r.error } : { ok: true, message: '체크인을 기록했습니다.', href: '/ai' }
    }
    case 'memo_tidy': {
      const r = await saveInitiativeNoteAction(s('initiative_id'), s('note'))
      return r.error ? { ok: false, message: r.error } : { ok: true, message: '메모를 바꿨습니다.', href: `/initiatives/${s('initiative_id')}` }
    }
    case 'attachment_summary': {
      const r = await summarizeAttachmentAction(s('attachment_id'))
      return r.error ? { ok: false, message: r.error } : { ok: true, message: `요약 상태: ${r.status ?? '완료'}` }
    }
    default:
      return { ok: false, message: '알 수 없는 제안입니다.' }
  }
}

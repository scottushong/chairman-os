'use client'

import { useActionState, type ReactNode } from 'react'

import type { BlueprintState } from '@/app/actions/blueprint'
import { BTN_PRIMARY } from '@/components/purchasing/shared'

/**
 * 0081 화면의 작은 입력 폼 — 서버 액션(app/actions/blueprint.ts) 하나 + 저장 버튼 + 결과 한 줄.
 * 칸은 서버 화면이 children으로 그린다(이름 = 액션이 읽는 FormData 키). 판정은 DB가 한다.
 */
export function ActionForm({
  action,
  submit,
  children,
  label,
}: {
  action: (prev: BlueprintState, form: FormData) => Promise<BlueprintState>
  submit: string
  children: ReactNode
  label: string
}) {
  const [state, formAction, pending] = useActionState(action, {})
  return (
    <form action={formAction} aria-label={label} className="flex flex-wrap items-end gap-2 text-t12">
      {children}
      <button type="submit" className={BTN_PRIMARY} disabled={pending}>
        {pending ? '저장 중…' : submit}
      </button>
      {state.error ? (
        <p role="alert" className="basis-full text-t11 text-critical">
          {state.error}
        </p>
      ) : state.ok ? (
        <p role="status" className="basis-full text-t11 text-ok">
          저장했습니다.
        </p>
      ) : null}
    </form>
  )
}

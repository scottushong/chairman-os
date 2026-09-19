'use client'

import { useRef, useState } from 'react'

import { removeInitiativeLogoAction, saveInitiativeLogoAction } from '@/app/actions/initiatives'
import { InitiativeLogo } from '@/components/initiatives/initiative-logo'
import { GlassCard } from '@/components/ui/glass-card'
import { LOGO_MIME } from '@/lib/initiative-logo'

/**
 * 상세 상단의 로고 칸 (Step 2). FormData로 보낸다 — 파일은 다른 칸처럼 Server Action 인자로
 * 직렬화할 수 없다.
 *
 * 낙관적 미리보기가 없다 — 방금 고른 파일을 로컬 URL로 먼저 보여 주면, 업로드가 실패했을 때
 * 화면에만 있는 로고가 그대로 남는다. 서버가 반영한 뒤 revalidatePath로 내려오는 새 서명 URL만
 * 그린다(path/url prop이 부모 서버 컴포넌트에서 다시 내려온다).
 *
 * 권한은 여기서 판정하지 않는다. canEdit은 버튼을 보여줄지 정하는 안내일 뿐, 실제 문은
 * 0018 initiative_logos_write_*(RLS)다 — 통과 못 하면 saveInitiativeLogoAction이 문구를 만든다.
 */
export function LogoUpload({
  initiativeId,
  title,
  path,
  url,
  canEdit,
}: {
  initiativeId: string
  title: string
  path: string | null
  url?: string
  canEdit: boolean
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 change 이벤트가 뜨도록 비워 둔다.
    if (!file) return
    setError(null)
    setPending(true)
    const fd = new FormData()
    fd.set('initiative_id', initiativeId)
    fd.set('logo', file)
    const result = await saveInitiativeLogoAction(fd)
    setPending(false)
    if (result.error) setError(result.error)
  }

  async function onRemove() {
    setError(null)
    setPending(true)
    const result = await removeInitiativeLogoAction(initiativeId)
    setPending(false)
    if (result.error) setError(result.error)
  }

  return (
    <GlassCard className="flex flex-wrap items-center gap-3">
      <InitiativeLogo title={title} path={path} url={url} size={56} />

      {canEdit ? (
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
              className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-[11.5px] text-ink-dim transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {pending ? '올리는 중…' : path ? '로고 바꾸기' : '로고 올리기'}
            </button>
            {path ? (
              <button
                type="button"
                onClick={onRemove}
                disabled={pending}
                className="rounded-md px-2 py-1.5 text-[11.5px] text-critical transition-colors hover:underline disabled:cursor-not-allowed"
              >
                삭제
              </button>
            ) : null}
            <input
              ref={inputRef}
              type="file"
              accept={LOGO_MIME.join(',')}
              className="hidden"
              onChange={onPick}
            />
          </div>
          <p className="mt-1 text-[10.5px] text-ink-muted">PNG · JPG · WebP, 2MB까지</p>
          {error ? (
            <p role="alert" className="mt-1 text-[11px] text-critical">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <span className="text-[12.5px] font-semibold text-ink">{title}</span>
      )}
    </GlassCard>
  )
}

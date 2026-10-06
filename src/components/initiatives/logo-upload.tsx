'use client'

import { useState } from 'react'

import { removeInitiativeLogoAction, saveInitiativeLogoAction } from '@/app/actions/initiatives'
import { InitiativeLogo } from '@/components/initiatives/initiative-logo'
import { GlassCard } from '@/components/ui/glass-card'
import { FileDropZone } from '@/components/ui/file-drop-zone'
import { checkLogoFile, LOGO_MIME } from '@/lib/initiative-logo'

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

  /** 공통 첨부 부품이 형식 · 2MB를 먼저 보고, 맞는 첫 장만 넘긴다. */
  async function uploadLogo(file: File) {
    setError(null)
    const fd = new FormData()
    fd.set('initiative_id', initiativeId)
    fd.set('logo', file)
    const result = await saveInitiativeLogoAction(fd)
    if (result.error) throw new Error(result.error)
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
          <FileDropZone
            label="이니셔티브 로고 올리기"
            accept={LOGO_MIME.join(',')}
            check={checkLogoFile}
            max={1}
            upload={uploadLogo}
            disabled={pending}
            pickLabel={pending ? '처리 중…' : path ? '로고 바꾸기' : '로고 올리기'}
            hint="PNG · JPG · WebP, 2MB까지 · 한 장만"
            extra={
              path ? (
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={pending}
                  className="min-h-11 rounded-md px-2 text-t11h text-critical transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed lg:min-h-0 lg:py-1.5"
                >
                  삭제
                </button>
              ) : null
            }
          />
          {error ? (
            <p role="alert" className="mt-1 text-t11 text-critical">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <span className="text-t12h font-semibold text-ink">{title}</span>
      )}
    </GlassCard>
  )
}

'use server'

import { revalidatePath } from 'next/cache'

import { canWriteDocuments } from '@/lib/auth/roles'
import { currentUser } from '@/lib/auth/session'
import { getRepository } from '@/lib/repository'
import { SECURITY_CLASS, type SecurityClass } from '@/types'

/**
 * CH-042 문서 등록.
 *
 * 파일을 받지 않는다. 사내 스토리지의 링크 한 줄만 받는다 —
 * Vault 문서의 실체는 Chairman OS에 두지 않기로 되어 있다(CLAUDE.md 데이터 원칙).
 * 업로드 경로를 만들면 그 원칙이 첫날부터 깨진다. 그래서 이 화면에는 파일 입력 자체가 없다.
 *
 * 권한(0048): 세션 안내(canWriteDocuments — 그 회사의 '/documents/<business_id>' 줄)로 먼저 한국어 거부를 돌려주고,
 * 진짜 판정은 0048 documents_insert(can_write_documents(business_id) AND 등급 ≤ 내 열람 등급)가 한다.
 */

const NO_DOC_WRITE = '이 회사에 문서를 등록할 권한이 없습니다. 회장이 사용자 화면의 «모듈 권한 → 문서»에서 그 회사의 «문서 등록»을 켜야 합니다.'

export interface CreateDocumentState {
  error?: string
}

function isSecurityClass(value: unknown): value is SecurityClass {
  return SECURITY_CLASS.includes(value as SecurityClass)
}

/**
 * 링크가 링크인지만 본다. 도메인을 화이트리스트로 묶지 않는 이유는
 * 사내 스토리지 주소를 이 코드가 알고 있어야 하기 때문이다 — 회사마다 다르고, 바뀐다.
 *
 * http/https만 통과시킨다. javascript: 같은 스킴이 들어오면 그 링크를 누르는 순간
 * 회장 세션에서 스크립트가 도는 자리가 된다.
 */
function isStorageLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function createDocument(input: {
  title: unknown
  businessId: unknown
  docType: unknown
  securityClass: unknown
  storageUrl: unknown
  /** 0038. '' = 폴더 없음. */
  folderId?: unknown
  /** 0038. 쉼표로 가른 태그. */
  tags?: unknown
}): Promise<CreateDocumentState> {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const businessId = typeof input.businessId === 'string' ? input.businessId : ''
  const docType = typeof input.docType === 'string' ? input.docType.trim() : ''
  const storageUrl = typeof input.storageUrl === 'string' ? input.storageUrl.trim() : ''

  if (!title) return { error: '문서명을 입력하세요.' }
  if (!businessId) return { error: '소속을 고르세요.' }
  if (!isSecurityClass(input.securityClass)) return { error: '알 수 없는 보안등급입니다.' }
  if (!isStorageLink(storageUrl)) {
    return { error: '사내 스토리지 링크는 http:// 또는 https:// 로 시작해야 합니다.' }
  }

  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (!canWriteDocuments(user, businessId)) return { error: NO_DOC_WRITE }

  try {
    const repo = await getRepository()
    await repo.createDocument(
      {
        title,
        business_id: businessId,
        // 0001의 doc_type은 자유 문자열이다(Contract/IR/TDS/MSDS/Meeting…). 비면 '기타'로 둔다.
        doc_type: docType || '기타',
        security_class: input.securityClass,
        storage_url: storageUrl,
        folder_id: Number(input.folderId) > 0 ? Number(input.folderId) : null,
        tags:
          typeof input.tags === 'string'
            ? input.tags.split(',').map((t) => t.trim()).filter(Boolean)
            : [],
      },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[createDocument]', e)
    return {
      error:
        e instanceof Error && /documents_write|documents_insert|42501|PGRST301|row-level security/.test(e.message)
          ? '이 소속 · 등급으로 문서를 등록할 권한이 없습니다. 자기 열람 등급보다 높은 등급으로는 등록하지 못합니다.'
          : e instanceof Error && /document_folder_mismatch/.test(e.message)
            ? '고른 폴더가 이 소속의 폴더가 아닙니다.'
            : '문서를 등록하지 못했습니다. 잠시 후 다시 시도하세요.',
    }
  }

  revalidatePath('/documents')
  return {}
}

/** 0038 폴더 하나 만들기. 같은 회사 · 팀 · 부모 아래 같은 이름은 DB가 막는다(doc_folders_name_unique). */
export async function createDocFolder(input: {
  businessId: unknown
  teamId?: unknown
  parentId?: unknown
  name: unknown
}): Promise<CreateDocumentState> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const businessId = typeof input.businessId === 'string' ? input.businessId.trim() : ''
  if (!name) return { error: '폴더 이름을 넣으세요.' }
  if (!businessId || businessId === 'group') return { error: '폴더는 회사 아래에만 만듭니다.' }
  const user = await currentUser()
  if (!user) return { error: '세션이 만료되었습니다. 다시 로그인하세요.' }
  if (!canWriteDocuments(user, businessId)) return { error: NO_DOC_WRITE.replace('문서를 등록할', '폴더를 만들') }
  const teamId = typeof input.teamId === 'string' && input.teamId.trim() ? input.teamId.trim() : null
  const parentId = Number(input.parentId) > 0 ? Number(input.parentId) : null
  try {
    const repo = await getRepository()
    await repo.saveDocFolder({ business_id: businessId, team_id: teamId, parent_id: parentId, name }, { user_id: user.user_id, role: user.role })
  } catch (e) {
    console.error('[createDocFolder]', e)
    const message = e instanceof Error ? e.message : ''
    if (/duplicate|unique|23505/.test(message)) return { error: '같은 자리에 같은 이름의 폴더가 있습니다.' }
    if (/42501|PGRST301|row-level security/.test(message)) return { error: '이 회사에 폴더를 만들 권한이 없습니다.' }
    return { error: '폴더를 만들지 못했습니다.' }
  }
  revalidatePath('/documents')
  return {}
}

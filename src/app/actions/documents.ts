'use server'

import { revalidatePath } from 'next/cache'

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
 * 권한은 여기서 보지 않는다. 0002의 documents_write가 회사 범위와 모듈 쓰기 권한을 같이 본다.
 */

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
      },
      { user_id: user.user_id, role: user.role },
    )
  } catch (e) {
    console.error('[createDocument]', e)
    return {
      error:
        e instanceof Error && /documents_write|42501|PGRST301/.test(e.message)
          ? '이 소속에 문서를 등록할 권한이 없습니다.'
          : '문서를 등록하지 못했습니다. 잠시 후 다시 시도하세요.',
    }
  }

  revalidatePath('/documents')
  return {}
}

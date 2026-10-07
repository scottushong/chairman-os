/**
 * 0055 «<회사> 사용자 관리자» — DB(staff_admin_invite 등) · dummy가 던지는 오류 키를 사람 말로.
 * 이 문장들은 직원(관리자)이 읽는다 — «대표»로 쓴다(직원 화면 용어 원칙, CLAUDE.md).
 * 'use server' 파일(actions/users.ts)은 async 함수만 내보낼 수 있어서 여기 둔다 — scripts/check-finance-ledger.ts가 잰다.
 */
export const STAFF_ADMIN_ERROR: Readonly<Record<string, string>> = {
  staff_admin_denied: '이 회사의 사용자 관리자 권한이 없습니다. 대표에게 문의하세요.',
  staff_admin_role: '사원 · 팀장만 초대할 수 있습니다. 그 위 역할은 대표가 초대합니다.',
  staff_admin_email: '이메일 주소를 확인하세요.',
  staff_admin_name: '이름 · 직함을 확인하세요(이름은 필수, 각각 60자까지).',
  staff_admin_email_taken: '이 이메일로는 초대할 수 없습니다. 이미 초대했거나 계정이 있는지 대표에게 확인하세요.',
  staff_admin_rate: '오늘 초대를 너무 많이 했습니다(24시간 20건). 더 필요하면 대표에게 요청하세요.',
  staff_admin_team: '팀을 고르세요(이 회사의 팀만 고를 수 있습니다).',
  staff_admin_team_self: '본인이 팀장인 팀(또는 본인 아래 사람이 팀장인 팀)으로는 초대할 수 없습니다. 대표에게 요청하세요.',
  staff_admin_boss_missing: '상사를 고르세요. 상사 없이는 저장할 수 없습니다.',
  staff_admin_boss_invalid: '상사는 이 회사에서 지금 일하는 사람이어야 합니다.',
  staff_admin_boss_self: '본인이나 본인 아래 사람은 상사로 고를 수 없습니다. 실제 상사를 고르세요.',
  staff_admin_class: '본인 등급보다 높은 보안등급은 줄 수 없습니다.',
  staff_admin_grant: '본인이 가진 권한만 줄 수 있습니다. 월 마감은 줄 수 없습니다.',
  staff_admin_language: '표기 언어를 확인하세요.',
  staff_admin_not_found: '취소할 수 있는 초대가 아닙니다. 본인이 보낸, 아직 가입하지 않은 초대만 취소됩니다.',
}

const FALLBACK = '저장하지 못했습니다. 잠시 후 다시 시도하세요.'

/**
 * 오류 문장에서 키를 **낱말 단위로** 찾는다 — staff_admin_team이 staff_admin_team_self 안에서 걸리지 않게
 * 앞뒤가 [a-z0-9_]가 아닌 자리만 본다(\b는 밑줄을 낱말 글자로 봐서 'staff_admin_team_self'를 이미 갈라 주지만,
 * 템플릿 문자열 안에 쓰면 백스페이스가 되는 함정이 있었다 — 리뷰 I6). 긴 키부터 본다.
 */
export function staffAdminMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  const keys = Object.keys(STAFF_ADMIN_ERROR).sort((a, b) => b.length - a.length)
  for (const key of keys) {
    let at = message.indexOf(key)
    while (at !== -1) {
      const before = at === 0 ? '' : message[at - 1]
      const after = message[at + key.length] ?? ''
      if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return STAFF_ADMIN_ERROR[key]
      at = message.indexOf(key, at + 1)
    }
  }
  return FALLBACK
}

# 2단계 — 온보딩 위임 «DY 사용자 관리자» 현황 표

작성 2026-10-06 · 브랜치 `feat/approvals-0054` · 근거: 0011 · 0025 · 0026 · 0028 · 0042 · 0043 · 0047 · 0048 · 0054, `src/app/(dashboard)/settings/users`, staging 카탈로그(읽기 전용 조회).

회장 결정 B: 김병훈(DY 경영지원 · 사원)은 사원 그대로, 회사마다 **«<회사> 사용자 관리자»** 능력을 따로 받는다. 주고 거두는 것은 회장만.

## 현황 표

| B 항목 | 지금 되는 것 | 없는 것 | 이번에 만든 것 |
|---|---|---|---|
| «DY 사용자 관리자» 능력 | 없음. 0026 위임 초대가 **아무 활성 사용자에게나** 열려 있다(자기 subtree로만) — **0055가 닫았다(리뷰 I3)** | 능력 표시 · 판정 함수가 없다. 앱 `canManageUsers()` = 회장뿐 | 모듈 줄 `'/users/<회사>'` can_write(회장만 씀 — 0002 `module_access_admin_write`) + `can_manage_users(회사)`. 조직도 사람 패널에 «<회사> 사용자 관리자» 체크(감사 = setModuleGrant와 같은 permission_change) |
| 초대 범위 = DY 전체 | 0026: 회사는 초대자가 보는 회사 안, **상사가 초대자 subtree 안**이어야 한다 | subtree를 요구하지 않는 길 | `staff_admin_invite()`(definer) — 회사 = 그 회사 하나 고정, 상사는 그 회사의 활성 사람 누구나(초대자 subtree 요구 없음) |
| 사원 · 팀장만 | Executive 이상은 회장 결재 큐로 **줄을 선다**(거부가 아님) · 폼은 Chairman만 숨김 | 역할 상한 | RPC가 Member · TeamLead 외에는 **거부**(`staff_admin_role`, 큐에 넣지 않음). 화면도 둘만 그린다 |
| 보안등급 상승 금지 | 0026 정책이 `class_rank ≤ max_class()` | — | RPC에서 같은 판정 · `Public` 거부 |
| 자기 권한 안에서만 권한 주기 | 초대에 모듈 권한 칸이 없다. 모듈 줄 쓰기는 회장만 | 초대에 권한을 싣는 칸 · 가입 때 붙이는 길 | `user_invitations.module_grants`(jsonb) — 허용 키 둘(DY 재무 입력 · DY 문서 등록; «결재 올리기»는 새 직원 기본(0054)이라 위임 권한이 아니다 — 리뷰 I4)만, 초대자가 **그 줄의 can_write를 가진 것만**. 가입 때 `apply_user_invitation`(0047 본문 복사)이 **초대자의 지금 권한으로 다시 확인**해 붙인다(없으면 건너뜀 — 닫힌 쪽) |
| 마감 금지 | 마감 = `/finance/<회사>` can_approve | — | 위임 권한은 늘 can_write=true · can_approve=false. RPC가 받는 값이 키 목록뿐이라 마감을 실을 칸 자체가 없다 |
| 즉시 효력 | 사원 · 팀장 위임 초대는 가입 즉시 이행(0043 → 0011 → apply) | 재무 기본값은 위임 초대에 안 붙음(0047, 의도) | 같은 즉시 이행 + 위 권한 적용. 0054 «결재 올리기» 자동 부여는 그대로 |
| 대표에게 알림 | `notifications`(kind 'system') — authenticated insert 없음 | 위임 초대 알림 | RPC가 회장에게 알림 한 줄(«<관리자>님이 DY에 <이름>님(<역할>)을 초대했습니다», DB 문구에 «회장» 없음) |
| 아침 요약 숫자 | 야간 브리핑의 숫자 한 줄(activity_digest) | AIAgent가 초대를 셀 길 | `delegated_invite_count(since)`(definer, Chairman · AIAgent만) + night-brief 한 줄(숫자만) |
| 취소 가능 | 회장만 취소 · 위임자는 못 함 | 관리자 본인의 대기 초대 취소 | `staff_admin_revoke_invitation()` — 본인이 넣은 위임 초대 중 미수락만. 회장은 예전 그대로 전부. 능력 회수 = 회장의 모듈 줄 삭제 → 그 관리자의 대기 위임 초대 자동 취소(감사 먼저), 관리자 회수 · 퇴사도 같다(리뷰 I5). 가입 때 초대자가 관리자가 아니면 그 초대로는 권한을 만들지 않는다 |
| 감사 | 초대 · 회수 · 모듈 권한은 permission_change가 **먼저** | — | 초대 · 취소는 RPC 안에서 감사 먼저, 가입 때 붙인 권한은 `module_grant_audit`(0048 → 0055가 `/users/` 회사도 읽게) |
| 남의 결재 못 봄 | 결재 읽기 = 본인 · subtree · 결재선 첫 칸 | **충돌**: 0026 경로는 피초대자를 초대자 subtree 아래로 넣어 결재 · 업무 · 문서가 보이게 된다 | 새 길은 상사를 초대자 subtree 밖에서만 고르게 한다(본인 · 본인 아래 = `staff_admin_boss_self` 거부). 고르기 화면은 이름 · 팀 · 역할만 돌려주는 `staff_admin_options()` |
| 팀 · 상사 필수 | 위임은 상사 필수(0026), 팀은 선택 · 팀장 위임은 자기 팀 고정 | 팀 필수 · 회사 소속 확인 | RPC: 팀 필수 + 그 회사 팀 · 팀장이 관리자 본인 · 그 아래인 팀은 거부(`staff_admin_team_self`, 리뷰 I2) · 상사 필수(`staff_admin_boss_missing`). 화면: 상사가 비면 저장 버튼이 꺼지고 안내 |

## 리뷰 반영 (2026-10-06)

- I1 insert 정책이 설정(GUC)만 보지 않고 RPC의 불변식을 다시 본다 · 취소 설정 아래 update는 revoked_at만.
- I3 0026 `user_invitations_delegated_insert`를 닫았다 — 초대는 대표(0011) 또는 사용자 관리자(RPC)만. 그 밖의 직원 화면에는 «직원 초대는 대표 또는 사용자 관리자가 합니다» 한 줄.
- M2 이미 초대 · 계정이 있는 이메일은 한 문장(«이 이메일로는 초대할 수 없습니다») · M5 이름 · 직함 60자 · 관리자당 24시간 20건.

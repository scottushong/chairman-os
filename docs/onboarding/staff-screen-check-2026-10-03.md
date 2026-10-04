# 직원 화면 점검 결과 (2026-10-03)

**방법:** dummy 모드 production 빌드(`next build` → `next start`, 계정마다 `DUMMY_USER`)에서 계정마다 화면 160개를 링크를 따라 돌며
본문 · title · aria-label · placeholder · option · meta에서 «회장 · Chairman · 시티 · 의존 · 주의 · 왕관 · Overnight · 아침 루틴 · 야간 브리핑»,
왕관 아이콘, 본문의 기능번호(CH-0xx · Phase N · §)를 찾았다. 고친 뒤 다섯 계정 전부 재점검(1회) + dy_ceo · sales_staff 재점검(2회).
dummy 시드에 GroupCFO 사람이 없어 다섯 계정으로 했다.

## 계정별 · 화면별 남은 건수 (최종)

| 계정 | 역할 | «회장/Chairman» | 회장 전용 기능 이름 | 왕관 | 기능번호 | 남은 화면 |
|---|---|---|---|---|---|---|
| dy_ceo | BusinessCEO | 14 | 0 | 0 | 3 | /privacy |
| exec | Executive | 14 | 0 | 0 | 3 | /privacy |
| sales_lead | TeamLead | 14 | 0 | 0 | 3 | /privacy |
| sales_staff | Member | 14 | 0 | 0 | 3 | /privacy |
| support_lead | TeamLead(경영지원) | 14 | 0 | 0 | 3 | /privacy |

- **/privacy 하나만 남았다** — «회장» 14곳 · «그룹 시티» · «야간 브리핑» · 배지 «CH-051 · 0031» «Phase 6-2 · 8 G-3». 고지 문서라 `docs/privacy-revision-draft-2026-10.md`를 회장이 확인한 뒤 적용한다.
- /settings의 «의존성»은 소프트웨어 의존성 문장(오탐).

## 처음 점검에서 걸린 것 → 고친 곳

| 화면 | 걸린 것 | 계정 | 고친 곳 |
|---|---|---|---|
| 화면 제목 38곳 | CH-0xx · Phase · § 표기 | 전원 | `components/layout/spec-code.tsx` — PageHeader가 회장에게만 그림 |
| /tasks/[id] · /projects/[id] · /documents/[id] | 칸 제목 옆 CH-040 · CH-051 | 전원 | 같은 SpecCode |
| /business/[id] | KPI 타일 CH-006~010 · 재무 추이 CH-025~026 · 전략 좌표/핵심 인력 CH-024 · «CH-040에서 보기» | 회사를 보는 역할 | `showSpec` · `chair` prop, 링크는 «업무에서 보기 · 결재에서 처리» |
| /coming-soon (메뉴 9개) | «CH-052 … · Phase 2 범위입니다 · Layer 2 기능 시스템입니다» | 전원 | `lib/boss.ts` specText |
| /settings | «Phase 6-3에서 붙습니다» | 전원 | «다음 단계에서» |
| /documents/[id] | «(Phase 10)» | 전원 | 회장에게만 |
| /approvals · 업무 상세의 결재 올리기 | «(CH-051)» | 전원 | 문장에서 뺌(회장 포함) |
| /tasks/[id] 업무 컨트롤 | «(CH-051)» · «Business OS(Layer 1)» | 전원 | «각 회사 업무 시스템» |

## 미결

- /privacy 개정 적용(회장 확인 대기).
- 다섯 계정 모두 `/business/biz_debutphoto` 링크가 404 — 링크 출처 미확인(DEFERRED).
- 직원 안내서 PDF(`staff-ko.pdf`)를 다시 만들었다(md 13:41 개정 반영). 화면 캡처 검토는 안 했다.

## 2026-10-04 재점검 (/privacy 개정 · 다른 회사 노출 차단 뒤)

**방법:** 같은 방식(dummy production 빌드, 계정마다 `DUMMY_USER`, 링크를 따라 220화면). 찾는 낱말에 «Founder · Attention»과
**자기 회사 밖 회사 이름**(VANA · Sticky · HOF · Boram/보람 · 데뷔포토/DEBUT PHOTO)을 더했고, 링크(`href`)에서 다른 회사 id ·
`/group` · `/dependency` · `/attention` · `/initiatives`를 찾았다.

| 계정 | 역할 | 화면 | 낱말 | 다른 회사 이름 | 다른 회사 · 회장 전용 링크 |
|---|---|---|---|---|---|
| dy_ceo | BusinessCEO | 220 | 0 | 0 | 0 |
| exec | Executive | 220 | 0 | 0 | 0 |
| sales_lead | TeamLead | 220 | 0 | 0 | 0 |
| sales_staff | Member | 220 | 0 | 0 | 0 |
| support_lead | TeamLead(경영지원) | 220 | 0 | 0 | 0 |

- **`/business/biz_debutphoto` 링크의 출처:** dummy 어댑터의 목록 일부가 회사로 거르지 않았다 — `/calendar`의 마일스톤(그 링크) ·
  `/approvals`의 다른 회사 결재(VANA · Sticky · Boram). live는 RLS(has_business 등)가 이미 자른다. dummy에 같은 문을 옮겨 적었다(f23b3f3).
- 같은 원인 전수: AI 도우미 직원 예시(«VANA 9월 손익 합계» · 이니셔티브) · 문서 등록 placeholder(«Sticky Alliance») · AI 도구 설명의 회사 예시를 뺐다.
- /privacy 개정 적용(1176f82) — «회장» · 회장 전용 기능명 · 내부 코드 배지 0건.
- /settings «의존성» 오탐은 문장을 «쓰는 라이브러리»로 바꿔 없앴다.

# 2026-10-20 옛 재무 화면 정리(A5) — 무엇을 지웠고 · 어디로 옮겼고 · 되돌리는 길

브랜치 `release/2026-10-20`, 커밋 «feat(finance): 예전 자료 가져오기 · 옛 재무 화면 정리 (A2 · A5)». 결정: `docs/decisions/2026-10-20-finance-legacy.md`.
**DB 표 · 데이터는 하나도 지우지 않았다** — 지운 것은 git 안의 화면 코드뿐이다(되돌릴 수 있다).

## 지운 것

| 무엇 | 파일 | 옛 주소로 들어오면 |
|---|---|---|
| «월별 간이 손익(CH-026)» 12달 손입력 표 | `src/components/finance/monthly-grid.tsx` · `src/app/actions/monthly.ts`(saveMonthlyBooks) | `/finance/<회사>/monthly` → `/finance?biz=<회사>&tab=pl`(`?pl=YYYY-MM`이면 `&month=`) |
| «월별 손익 — 재고 반영» 화면(0072/0075 패널의 손익 · 재고 · 원가 근거 · 자금 참고 · 원료별 표) | `src/app/(dashboard)/finance/[business_id]/monthly/page.tsx`(화면 → 넘기기만) · `src/components/finance/monthly-pl-panel.tsx`의 표시 부분 | 같은 곳 |
| 원본끼리 탭의 «월별 입력» | `src/components/finance/books-nav.tsx` | — |
| 재무 현황 탭 줄의 «그룹 합산 · 재무제표 원본 ›» 링크 | `src/app/(dashboard)/finance/page.tsx` | — |

손입력으로 넣었던 값은 장부 전표(적요 «YYYY-MM 월별 간이 손익»)로 그대로 있고, 재무 현황 · 체크표 «월별 손익계산서»가 그대로 읽는다(옮겨 담지 않음 — 두 번 세지 않게). 대표가 자료 올리기의 «예전 자료 가져오기»를 누르면 «이미 장부에 있음»으로 기록된다.

## 옮긴 것

| 무엇 | 예전 자리 | 지금 자리 | 권한 |
|---|---|---|---|
| 마감 상태 · 잠정 저장 · 내부 마감 확정 · 다시 열기 | `/finance/<회사>/monthly` 아래 패널 | `/finance?biz=<회사>&tab=pl` 손익계산서 탭 아래 «내부 마감 · 재고 조정 · 설정»(`src/components/finance/pl-close-panel.tsx`) | 그대로(장부 쓰기 · 마감 권한 · 대표 · CFO) · 스위치 `monthly_pl` |
| 재고 조정 제안 · 승인 · 무효 | 같은 패널 | 같은 곳 | 그대로 |
| 설정(평가방법 · 허용오차 · 매출 원천 · 원료 대금 항목) | 같은 패널 | 같은 곳 | 대표 · 그룹 CFO |

## 메뉴에서만 뺀 것(화면 · 주소 · 권한 그대로)

재무제표 원본(`/finance/<회사>`) · 전표(`/journal`) · 계정과목(`/accounts`) · 공식 결산(`/statements/new`) · 재고 · 평가(`/valuation`) · 그룹 합산(`/finance?view=group`)
→ 재무 현황 오른쪽 위 **«원본 보기 ›»** 하나 아래(`src/components/finance-overview/originals-menu.tsx`) — **대표 · 그룹 CFO에게만** 보인다.
링크를 바꾼 곳: 회사 화면 `/business/<id>` «재무제표» → «재무 현황»(`/finance?biz=<id>`) · 대표 홈 «월별 손익 자세히» → 손익계산서 탭 · 요약 «② 재무상태 자세히»는 대표 · CFO에게만 · AI 어시스턴트 근거 링크(재무 · 잠정↔확정 대조) → 손익계산서 탭.

## 고친 검사

- `scripts/check-mobile.ts` 화면 10번 `/finance/biz_vana/monthly` → `/finance?biz=biz_vana&tab=pl`(키 `10-finance-pl`).
- `scripts/check-features.ts` 스위치 수 22(`finance_legacy_import` 더함) · `scripts/check-migrations.ts` 기본 줄 22.
- 새 `scripts/check-finance-legacy.ts`(check:finance-overview가 이어서 돈다) · `scripts/shot-finance-legacy-1020.ts`(스크린숏 · 직원 «회장» 0 · 옛 주소 넘김).

## 되돌리는 길

1. 코드 전체(A2 · A5 함께):

   ```bash
   git -C ~/projects/chairman-os-rel1020 log --oneline --grep "A2 · A5"
   ```

   나온 해시로:

   ```bash
   git -C ~/projects/chairman-os-rel1020 revert --no-edit <그 해시>
   ```

   월별 입력 표 · 재고 반영 패널 · 옛 링크가 돌아온다. DB는 그대로라 예전 화면이 예전 값을 그대로 보여 준다.
2. 화면만 하나 되살리기(예: 월별 입력 표만):

   ```bash
   git -C ~/projects/chairman-os-rel1020 checkout <그 해시>~1 -- src/components/finance/monthly-grid.tsx src/app/actions/monthly.ts "src/app/(dashboard)/finance/[business_id]/monthly/page.tsx" src/components/finance/monthly-pl-panel.tsx
   ```
3. 운영에 이미 나간 뒤라면: Vercel → Deployments → 직전 Production → «Promote to Production»(앱만 — 0089는 더하기만 해서 옛 앱과 함께 돈다).

## 확인(dummy)

스크린샷 `docs/onboarding/finance-shots-1020/` — 대표: `chair-finance-originals-pc.png`(«원본 보기 ›» 펼침) · `chair-pl-close-pc.png`(손익계산서 탭 아래 마감 · 조정 · 설정) · `chair-upload-legacy-1st-pc.png` · `chair-upload-legacy-2nd-pc.png`(두 번째 «새로 옮길 것이 없습니다») · 폰 셋. 직원(김병훈 자리): `staff-finance-*` · `staff-pl-*` · `staff-upload-*`(«원본 보기» · «예전 자료 가져오기» 없음 · «회장» 0 · 폰 가로 넘침 없음).

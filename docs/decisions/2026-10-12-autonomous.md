# 2026-10-12 8시간 자율 블록 — 스스로 정한 것

형식: 결정 · 이유 · 다른 선택지 · 바꾸는 법. 정하는 법 = 되돌리기 쉬운 쪽 · 노출이 적은 쪽 · 지금 구조를 덜 바꾸는 쪽.

| # | PHASE | 결정 | 이유 | 다른 선택지 | 바꾸는 법 |
|---|---|---|---|---|---|
| 1 | 0 | 이 블록 전에 시작한 C(PDF · 사진, 5acf8e0)를 PHASE 2의 본체로 쓰고, PHASE 2에서는 남은 것(바꾸기 대표 · CFO만 · 스위치)만 더한다 | 이미 끝낸 것은 다시 하지 않는다(지시) | C를 PHASE 1 뒤로 다시 만들기 | — |
| 2 | 0 | 브랜치 순서 feat/finance-v21 → feat/finance-pdf → feat/feature-switches → (PHASE 2 나머지) → feat/monthly-pl → … | PHASE 1(스위치)이 C 뒤에 왔지만 C는 이미 커밋돼 있어 그 위에 쌓는다 | 스위치를 C 앞에 rebase | 반영 때 순서대로 merge -m |
| 3 | 3 | D 본문은 `C:\Users\Edison Hong\projects\D-monthly-pl.txt` 원문(복사본 docs/specs/2026-10-12-monthly-pl-D.txt) | 지시: 원문 우선 | 요약판 | — |
| 4 | 1 | 스위치를 끄면(enabled=false) 대표에게도 꺼진다. 범위만 좁히려면 «보는 범위»를 대표만으로 | «끄기»가 반영에서 빼기의 미리보기가 되게 — 대표가 끈 뒤 화면을 직접 확인할 수 있다 | 끄면 대표만 남기 | `featureOnFor`(src/lib/features.ts) · `feature_on`(0073) 한 줄 |
| 5 | 1 | 앱 판정은 0073 표가 없거나 그룹 줄이 없는 키를 **기본값**으로(DB의 feature_on은 모르는 키 = 꺼짐) | master push = 앱이 DB보다 먼저 나갈 수 있다 — 화면이 갑자기 사라지지 않게. DB 쪽은 새 RPC가 부르는 문이라 닫힌 쪽 | 앱도 꺼짐 | `featureOnFor`의 `if (!row)` 줄 |
| 6 | 1 | 판정 순수 함수는 `src/lib/features.ts`, DB 읽기 `featureOn`은 `src/lib/features-server.ts`(server-only)로 나눴다 | 클라이언트 화면(스위치 카드)과 순수 검사(check:features)가 목록을 같이 쓰게 | 한 파일 | 파일 합치기 |
| 7 | 1 | `intakeOpenFor`는 DB를 읽지 않는 껍데기(기본값만). 화면 · 액션은 모두 `featureOn(user, 'intake')`로 바꿨다 | 옛 함수는 동기라 DB를 못 읽는다. 옛 검사(check:finance-pdf)는 그대로 돈다 | 옛 함수를 async로 | — |
| 8 | 1 | «자료 올리기»를 끄면 /finance/<회사>/upload 전체가 404 — 그 아래 «그 밖»(DY 엑셀 계정과목 · 월별 손익 · 공식 결산)도 함께 | 0070이 옛 /import를 이 화면으로 옮겼다 — 빼기와 같은 모양. 안내서에 «회사 줄로 대표만 켜 두기»를 적었다 | «그 밖»만 남기기 | upload/page.tsx의 notFound 줄을 v2 칸만 가리게 |
| 9 | 1 | 메뉴는 그룹 줄로만 뺀다(회사 줄은 화면 · 액션에서만 본다) | 사이드바는 회사를 모른다 | 회사별 메뉴 | `hiddenNavKeys` |
| 10 | 1 | /settings/features는 직원에게 `redirect('/me')`(보완함 /settings/feedback은 404 그대로) | CLAUDE.md «회장 전용 화면은 redirect('/me')» | 404 | page.tsx 한 줄 |
| 11 | 1 | 0073 staging 시험은 0072 뒤 · 0071 앞(check-staging-sql-0061.ts) · 기본 줄 md5 대조로 «바꾼 채 남김»도 잡는다 | 0071이 끝에서 소유자를 바꾼다 | 맨 뒤 | 블록 위치 |

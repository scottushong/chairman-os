# ECOUNT 엑셀 업로드 설계 (2026-10-02 · 설계만 — 구현은 회장 스크린샷(열 구성) 받은 뒤)

대상(우선순위): ① 계정과목(기초데이터 > 계정) → `accounts` ② 재무상태표·손익계산서(연간) → 공식 결산 ③ 월별 손익계산서 → 월별 입력.
공통: 파일 선택 → 미리보기(열 매핑 · 오류/누락 행) → 확인 후 등록. 그 회사 재무 쓰기 권한자만(`can_keep_books`). 마감된 달 거부.
출처 «ECOUNT 엑셀»(잠정), 세무사 확정은 «확정»으로 따로. 원본 파일은 첨부로 보관, 감사 기록.

## 0. 설계를 정한 사실

1. `official_statements`는 정의상 **확정 층**이다(0020 머리 — «이 표에 들어왔다는 것이 곧 출처»). 활성 행은 기간당 하나(`official_statements_one_active` 0020:46)이고,
   이 표의 기간은 **월별 입력을 잠근다**(monthly.ts:71-80 · period.ts `isLocked`). 구분 칸 없이 ECOUNT 연간을 넣으면 잠정 숫자가 «확정»이 되고 그 해 월별이 잠긴다.
2. `official_statement_lines` 금액은 아직 KPI를 타지 않는다(헤더만 읽음) — 연간 업로드에 이중 계상 위험은 없고 «잠금» · «기준 문구»에만 영향.
3. 월별 입력은 달마다 요약 전표 한 장(`post_journal_entry`)이다 → journal_lines(source='manual') → `finance_ledger_cells` → finance_kpis.
   - 기존 결함: 같은 달을 다시 저장하면 전표가 한 장 더 생겨 **두 배**가 된다(monthly-grid.tsx:126-150).
   - 기존 결함: DY 월별 그리드는 표준 계정코드(4010 등)를 써서 **DY에서는 저장이 DB에서 막힌다** → DY 월별은 업로드가 사실상 유일한 입구.
4. 마감 판정은 DB(`journal_lines_manual_guard` 0016:217-235 — 그 달 이후 closings가 있으면 `closed_period`). 미리보기는 같은 판정을 먼저 보여 줄 뿐.
5. 사람 세션은 accounts에 `source='manual'`만 넣을 수 있고(0016:73) `'ecount'`는 Integration만(0015:273). `accounts_guard`가 source 변경을 막는다.
6. 첨부 대상은 initiatives · businesses · documents · decisions 넷(0045:126). `businesses/biz_dy`에 붙이면 회사 · 등급만 맞는 사람에게 다 보이고 AI 요약까지 탄다 — 재무 권한보다 넓다.
7. 기존 구멍: `official_statements_supersede` 정책(0020:82)에 칸 제한이 없다 — 재무 쓰기 권한자가 PostgREST로 memo · evidence_url을 고칠 수 있다. 구분 칸이 생기면 «잠정 → 확정 위조»가 되므로 같이 막는다.

## A. 공통

- **화면**: 새 탭 `/finance/[business_id]/import`(BooksNav «ECOUNT 업로드», `ECOUNT_CODE_BUSINESSES` 회사 + `canKeepBooks`일 때만). 계정과목 / 연간 / 월별 세 단.
  진입 링크: 계정과목 빈 상태 문구(accounts-manager.tsx:179), 재무 화면, statements/new · monthly(DY).
- **흐름**(서버가 원본을 두 번 읽는다):
  1. `startEcountImport` → finance_imports draft 행.
  2. `beginAttachment(entity_table='finance_imports')` → 브라우저가 Storage로 직접 업로드(Vercel 4.5MB 한도 회피). **AI 요약은 부르지 않는다.**
  3. `previewEcountImport` → 서버가 원본을 읽어 exceljs로 파싱 · 판정, DB 쓰기 없음. 사람의 선택(열 매핑 · 분류 · 이름→코드)만 overrides로 받는다.
  4. `commitEcountImport` → 같은 원본을 다시 읽고 다시 검증(클라이언트가 보낸 행은 믿지 않음, sha256 일치 확인) → 대상별 RPC 한 트랜잭션.
  5. `cancelEcountImport` → cancelled + 첨부 취소.
- **파서** `src/lib/ecount/excel/`: exceljs(`xlsx` 패키지 금지 — CVE). 수식은 result, 숫자 표기는 paste.ts `parseCell` 규칙(쉼표 · 괄호 음수 · ₩), 못 읽은 칸은 0이 아니라 오류.
  머리글 · 기간(«2025/01/01 ~ 2025/12/31») · 단위(원/천원) 자동 탐지, 합계 · 소계 · 로마숫자 머리 행 판별. .xls · csv는 받지 않고 «xlsx로 저장» 안내.
  순수 함수 + `scripts/check-ecount-import.ts`.
- **권한**: 화면 `canKeepBooks`, 최종 판정 DB `can_keep_books(target)`.
- **감사**: 대상별 RPC 안에서 audit_log를 같은 트랜잭션으로. note «ECOUNT 엑셀 업로드 — {종류} {기간} · 파일 {이름} · import {id}».
- **출처 꼬리표**

  | 대상 | 표시 |
  |---|---|
  | 계정과목 | `accounts.source='ecount'`(화면이 이미 «ECOUNT»로 표시) |
  | 연간 | `official_statements.basis='ecount_excel'` = «ECOUNT 엑셀(잠정)», 세무사 결산 `'accountant'` = «확정» |
  | 월별 | 전표 memo 머리 «[ECOUNT 엑셀]» + `finance_import_slips` 연결. 라인은 source='manual' 유지(0016 가드 그대로). 월 마감이 «확정»으로 만든다 |

## B. 대상별

### ① 계정과목 → accounts
- 매핑: 계정코드 → account_code(문자열, 앞자리 0 보존), 계정명 → name. 분류(section/category/cash_flow)는 ECOUNT가 주지 않으므로
  «구분» 열 + 코드 대역(K-GAAP 1xx 자산 … 9xx 영업외/법인세) + 이름 키워드로 **제안**하고 사람이 미리보기에서 확정. 사용안함 → active=false로 넣는다.
- 차단: 코드 공백 · 파일 안 중복 · 분류 미정 · section↔category 모순. 경고: 이름만 다름 · 파일에 없는 기존 계정(목록만) · 합계/제목 행 무시.
- **재업로드 = 병합**: 새 코드 추가, 기존 코드의 **분류는 절대 안 바꿈**(마감 달 KPI가 바뀐다), 이름은 diff를 보여 주고 체크한 것만, 파일에 없는 계정은 지우지 않음. 이력은 감사 before/after.

### ② 연간 재무제표 → official_statements (basis='ecount_excel')
- RPC `official_statement_import_ecount` — `official_statement_save`와 같은 구성(균형 검사 → ecount 활성 행 supersede → 헤더 · 라인 → 감사).
- 매핑: 과목 이름 → 같은 회사 활성 계정과 정확 일치, 모호하면 사람이 고름. 부호는 원장 규약(자산 · 비용 +, 부채 · 자본 · 수익 −). 영업외는 소속 머리로 부호.
  차감 계정은 음수 자산. 0원 줄 제외. BS+PL을 한 기간 한 결산으로.
- 차단: 계정 매칭 실패 · 숫자 오류 · 재무상태표 불균형 · **파일의 합계 행(자산총계 · 영업이익 · 당기순이익 등)과 계산 불일치(차액 표시)** · 기간 미상.
- **재업로드 = 새 버전(supersede)** — 0020에 이미 있는 장치. 지우지 않으니 대조가 남는다.
- **확정과의 관계**: 그 기간에 세무사 확정(`accountant`) 활성 행이 있으면 업로드 거부. 세무사 저장은 accountant 행만 supersede.
  월별 잠금 · 기준 문구는 accountant만 센다(monthly.ts:72 · monthly/page.tsx:41 · business/[id]/page.tsx:74 · statements/new/page.tsx:55).

### ③ 월별 손익 → 장부 전표
- RPC `ecount_monthly_import` — 달마다: 그 달 유효한 업로드 전표가 없으면 입력, 같으면 건너뜀, **다르면 정정 전표**(`post_correction`, 역분개 + 정정분개). 일자는 말일.
- 손익만으로는 전표가 닫히지 않으므로 그 달 순이익만큼 **대응 계정 한 줄**(DY 계정표에 «ECOUNT 월별손익 대응», equity)을 세운다 — 현금 · 채권 · 채무 KPI를 건드리지 않게.
  ECOUNT가 월별 재무상태표/합계잔액시산표도 주면 2단계에서 잔액 차이로 교체.
- 차단: 마감된 달 · 세무사 확정이 덮은 해 · 계정 매칭 실패 · 숫자 오류 · 행 합 ≠ 합계 열. 경고: 그 달에 수기 전표가 이미 있음(두 번 셀 수 있음, 금액 표시).
- **재업로드 = 정정 전표**(열린 달). 마감된 달은 거부 — 당월 자동 정정은 손익을 엉뚱한 달로 옮기므로 하지 않는다.

## C. DB 변경 — `0049_ecount_import.sql` (staging 먼저 · production은 회장 승인 · 리뷰 루프 대상)

1. `finance_imports`(신규): import_id · business_id · kind · period_key · status(draft/committed/cancelled) · file_name · file_sha256 · summary · created_by · 시각.
   RLS: 읽기 `can_read_books`, insert `can_keep_books and created_by=auth.uid() and status='draft'`, update는 만든 사람의 draft 전이만, delete 없음, AIAgent · Integration restrictive.
2. `finance_import_slips`(신규): business_id · month · slip_no(FK) · import_id · superseded_at, 활성 (business_id, month) unique.
3. 첨부 대상에 `finance_imports` 추가(entity check · `attachment_entity_visible` · `attachments_stamp` 한 case씩) — 재무 원본을 재무 권한자만 보게.
4. `accounts_books_insert`: `source in ('manual','ecount')` — 사람 업로드에도 «ECOUNT» 꼬리표.
5. `official_statements`: `basis`('accountant' 기본 | 'ecount_excel') · `import_id`, evidence 조건 교체, 활성 unique를 basis까지, **update는 superseded_at 채우기만 허용하는 guard**(0.7 구멍).
6. `official_statement_save()`: 0047 본문 + `and basis='accountant'` 한 줄(빠뜨리면 세무사 저장이 ECOUNT 행을 밀거나 활성 2행으로 깨진다).
7. 신규 RPC 둘(security invoker). 새 enum 값 없음 · force RLS 없음(0035). check-migrations에 검사 추가.

## D. 회장 스크린샷에서 확인할 열

| 대상 | 필수 | 있으면 좋음 | 스크린샷이 답해야 할 것 |
|---|---|---|---|
| ① 계정 | 계정코드 · 계정명 | 계정구분(자산/부채/자본/수익/비용) · 상위계정 · 차대구분 · 사용여부 | 코드 자릿수(101 / 1010) · 미사용 계정 포함 여부 · 내려받기 형식(.xlsx/.xls) |
| ② 연간 | 과목명 · 당기 금액 | 계정코드 · 전기 금액 · 소속 머리(유동자산 · 영업외수익) · 합계 행 | 금액 단위 · 당기 금액이 두 칸(소계/합계)인지 · 차감 계정 표기 · 기간 표기 위치 · 매출원가 내역 줄 · BS/PL 한 파일 여러 시트인지 · 과목명이 계정명과 같은지 |
| ③ 월별 | 과목명(또는 코드) · 1~12월 열 | 계정코드 · 합계 열 · 구분 머리 · 이익 소계 행 | **당월 발생액인지 누계(YTD)인지(가장 중요)** · 열 머리 표기(1월/2025-01/202501) · 연도 위치 · 단위 · 0과 공백 · 월별 재무상태표/시산표도 받을 수 있는지 · 차변/대변 열 분리 |

## E. 순서 · 크기

0. 0049 + check-migrations(중, **리뷰 루프**) → 1. 공통 기반(중) → 2. 계정과목(중, 리뷰: RLS · 감사) → 3. 연간(중, 리뷰: 돈) → 4. 월별(대, 리뷰: 돈 · DB).
계정이 먼저 들어와야 ②③이 매칭된다(FK) — 순서는 바꿀 수 없다.
범위 밖(DEFERRED): `saveMonthlyBooks` 재저장 이중 계상 · DY 월별 그리드의 표준 코드 — 둘 다 «업로드 전표 정정» 장치로 풀 수 있다.

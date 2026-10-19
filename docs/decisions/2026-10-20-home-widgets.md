# 2026-10-20 내 홈 위젯(0086) — 정한 것

지시문 `docs/specs/2026-10-20-home-widgets.txt` · 시안 `docs/specs/2026-10-20-home-widgets-mock.png`. 묻지 않고 정한 것과 이유(다른 선택지).

1. **새 주소 `/home` · 메뉴 «내 홈» 하나만** — 지시문의 좌측 메뉴 8개는 만들지 않았다(블록 조건). 직원에게 이미 있던 «내 홈»(/me)은 스위치가 켜진 사람에게만 «내 업무함»으로 이름을 바꿔 같은 이름 둘이 서지 않게 했다(0087 «결재 요청»과 같은 방식 · `navFor`). 스위치가 꺼진 사람의 메뉴는 예전 그대로(«내 홈» → /me) — 스크린숏 `OFF-1-menu-390.png`의 «내 홈 메뉴 없음»은 **새 «내 홈»(/home) 링크가 없음**을 뜻한다. 로그인 첫 화면 · 로고 · 하단 탭 «홈»은 그대로 /me(노출 적은 쪽 — 켜진 뒤 바꿀지는 대표 판단).
2. **스위치 `home_widgets`** — 그룹 기본 «대표만»(0086 기본 줄). 메뉴 · 화면 · 서버 액션 · DB 저장 함수 모두 «그룹 줄 또는 내가 속한 회사 줄 하나라도 켜짐»(0087 메뉴 규칙과 같다). check:features · check:migrations의 기본 줄 수 22 → 23.
3. **저장(0086 `home_layouts`)** — 사람마다 한 줄(user_id · schema_version · revision · widgets jsonb · updated_at). 읽기는 RLS 본인 줄만(`to authenticated using (user_id = auth.uid())` — 대표도 남의 배치를 못 읽는다). 쓰기는 정의자 함수 `home_layout_save(p_expected, p_schema, p_widgets)`만 — 사용자는 `auth.uid()`, 요청 본문에 사용자 id 없음, 표에 insert/update/delete grant 없음. 시스템 계정 · 회수된 사람 · 스위치 꺼진 사람 거부.
4. **충돌** — 저장은 «내가 읽은 판(revision)»을 같이 보낸다. 그 사이 다른 탭 · 기기가 저장했으면 `home_conflict` — 화면은 편집 내용을 그대로 두고 «최신 배치 불러오기(내 편집 버림)» / «내 편집으로 덮어쓰기(명시적으로)» 중 고르게 한다.
5. **모르는 위젯 · 권한 잃은 위젯** — DB는 kind 모양만 본다. 화면은 모르는 kind를 건너뛰고 **저장 때 그대로 돌려준다**(새 위젯 · 없어진 위젯 때문에 배치를 지우지 않는다). 권한을 잃은 위젯(전자결재 꺼짐)은 자리를 지키며 «권한 없음» — 편집에서 지울 수 있다. 같은 위젯 두 번은 초기 판에서 막는다(두 번째부터 버림).
6. **편집이 아닐 때 표시 범위(필터)를 바꾸면 그 자리에서 저장** — 시안처럼 위젯 머리의 고르기를 늘 보이고, 바꿀 때마다 한 번 저장(같은 충돌 규칙). 편집 중에는 다른 바꿈과 함께 «배치 저장» 때.
7. **위젯 연결(실제로 있는지 코드에서 확인)** — 내 업무 = `listTasks`(담당자 본인 · 기한 지남 → 마감 임박) · 전자결재 = `src/lib/approvals/widget.ts` 세 함수 그대로(건수 = «결재할 문서» 탭) · 일정 = `calendar_items`(오늘 · 이번 주) · 요청한 업무 = 내가 올린 결재 요청(업무에 요청자 칸이 없어서) · 공지 = 0038 공지(읽음 · 필독) · 최근 문서 = `listDocuments`(일반 · 공개 등급만) · 안전·설비 = 내가 올린 «설비수리 품의» · 즐겨찾기 = 내 메뉴 · 결재 양식. **근태·휴가는 이 시스템에 없어 «연동 준비 중»**(휴가 신청은 전자결재 양식 링크). 예시 데이터를 지어내지 않는다 — dummy 화면은 «개발용 dummy — 예시 데이터» 꼬리표, 시드 예시 줄은 «예시».
8. **필수 공지** — 공지 기능(0038)이 있다. 관리자 지정 = 공지 쓰기 권한자(Executive 이상)가 «맨 앞 고정»(pinned)한 공지 중 내가 볼 수 있고 안 내린 것. 위젯 판 밖에 두어 개인 편집으로 숨기지 못한다. 따로 «필수» 칸을 새로 만들지 않았다(구조 덜 바꿈).
9. **홈에 싣지 않는 것** — 급여 · 원가 · BOM · 재무 숫자 · 원료 단가 · 결재 금액(시안의 «320,000원»도 뺐다). `npm run check:home-widgets`가 홈 코드(주석 빼고) · 실제 dummy 위젯 응답에서 금지 낱말 · amount 칸을 찾는다.
10. **폰 하단 탭 «결재»** — 전자결재(approvals)가 켜진 **직원**만 /e-approval, 꺼진 사람과 대표는 예전 /approvals(대표의 «결정» 칸은 대표 결정 화면이라 그대로).
11. **/me «내 업무» 고침(덤)** — `Task.owner`는 어댑터가 이름으로 바꾼 이름표라 `owner === user_id` 비교가 늘 거짓이었다(직원 홈 «내 업무»가 늘 비어 보였다). `Task.owner_user_id`를 더해(live · dummy) 홈 위젯과 /me가 id로 비교한다.
12. **dummy 손잡이(live 없음)** — `DUMMY_HOME_OPEN=biz_dy`(회사 줄 전원) · `DUMMY_HOME_STATE=<파일>`(서버를 다른 DUMMY_USER로 다시 켜도 배치가 이어짐) · `DUMMY_HOME_FAIL=1`(저장 실패) · `DUMMY_HOME_WIDGET_FAIL=<kind>`(위젯 하나 실패).

## 반영 명령 — 0086은 «순서 밖» 번호다(--include-all 필요)

staging에는 0084 · 0085 · **0087**이 이미 있다(2026-10-20 읽기 확인: `supabase_migrations.schema_migrations` = 0084,0085,0087). 0086은 그보다 낮은 번호라 `supabase db push`는 `--include-all` 없이 «Found local migration files to be inserted before the last migration on remote database»로 거부한다(scripts/check-release.sh 가짜 CLI도 같은 동작을 시험).

- **production**: `cd ~/projects/chairman-os` 뒤 `bash scripts/release-production.sh --include-all <대기 번호 전부>` (예: 0087이 이미 들어가 있으면 `--include-all 0086 0089`). 번호가 틀리면 스크립트가 맞는 목록을 출력하고 멈춘다.
- **staging**: `npm run db:push:staging`(scripts/db-push.mjs)은 `--include-all`을 받지 않는다(check:db-safety가 막는 인자). 손으로: `npx supabase link --project-ref itpenmxyracfhyormcep` → `SUPABASE_DB_PASSWORD="$(grep ^SUPABASE_DB_PASSWORD .env.staging.local | cut -d= -f2-)" npx supabase db push --linked --include-all` (DEFERRED에 db-push.mjs 보강 후보).
- 미리 돌려 보기(쓰지 않음): `node scripts/build-staging-dryrun.mjs 0086 0086 --tests` → `npx supabase db query --linked -f supabase/.temp/dryrun_0086_0086_tests.sql` — 2026-10-20 결과 `ERROR: 0086-0086 DRYRUN PASS (1 files · tests 1/1 · 0086)`, 뒤에 읽어 보니 staging에 home_layouts · home_* 함수 · home_widgets 스위치 줄 0.
- 빼는 법: 브랜치에서 0086 · `src/lib/home` · `src/components/home` · `/home` 화면을 빼거나, /settings/features에서 «내 홈(위젯)»을 끈다(메뉴 · 화면 · 저장 RPC 모두 닫힘).

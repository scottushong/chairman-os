# 전자결재 반영 — 0087 (`/e-approval`)

**넣는 것:** 브랜치 `feat/approvals-0087` — Claude Code가 로컬 `master`에 합쳐 두었다(`git merge --no-ff -m`, **push 안 함**).
**마이그레이션: 0087 하나** — `supabase/migrations/0087_approvals.sql`(표 11 · 함수 36 · 비공개 버킷 `ea-files` + 정책 둘 · 기능 스위치 1줄 `approvals` 기본 «대표만»).
지시문: `docs/specs/2026-10-19-approvals.txt` · 시안: `docs/specs/2026-10-19-approvals-mock.png` · 결정: `docs/decisions/2026-10-19-approvals.md` · 화면 사진: `docs/onboarding/approvals-shots/`.

**주의 — 앞 번호:** 로컬 `master`에는 0082 · 0083 · 0084 · 0085도 아직 push 전이다(재무 현황 블록, `docs/onboarding/release-2026-10-19b.md`). production이 0081이면 dry-run에 **0082 · 0083 · 0084 · 0085 · 0087**이 나온다 — 그 순서로 함께 들어가는 것이 맞다. **0086(기억 엔진)은 다른 브랜치**라 여기 없다 — 번호가 비어 있어도 Supabase는 이름 순서대로 넣는다(0086이 나중에 오면 «앞 번호가 뒤에 옴» 경고 없이 들어가는지 그 블록에서 확인).

규칙: 상자 하나에 명령 하나. `&&`는 쓰지 않는다. «기대»와 다르면 멈추고 결과를 보낸다.

---

## 1) staging에 반영 (Git Bash)

```bash
cd ~/projects/chairman-os
```

```bash
git checkout master
```

```bash
npm run db:push:staging
```

기대: staging에 없는 번호(0082 · 0083 · 0084 · 0085 · 0087)만 적용. 0086이 목록에 있으면 멈춘다.
(Claude Code가 같은 본문 + 시험을 staging에서 한 트랜잭션으로 돌리고 되돌렸다 — `docs/onboarding/staging-tests/0087_staging_test.sql`, 결과는 보고서의 «0087 STAGING PASS» 줄.)

## 2) production 리허설 — 읽기만 (먼저)

```bash
RELEASE_DRY_RUN=1 bash scripts/release-production.sh 0087
```

기대: 대기 마이그레이션 목록(위 다섯 중 production에 없는 것) → `RELEASE_DRY_RUN=1 — 여기서 멈춘다` → `staging으로 돌아왔다.`

## 3) production 반영 — DB 다음 앱

```bash
bash scripts/release-production.sh 0087
```

기대: dry-run 목록 → `YES` → push → `나갈 커밋:` → `YES` → `git push origin master` → `배포 상태: success` → health JSON(`migration: 0087_approvals`).

## 4) 대표 화면에서 먼저 보기

1. `https://chairman-os-eosin.vercel.app/e-approval` — 기본 탭 «결재할 문서». 기본 스위치는 «대표만»이라 지금은 대표에게만 메뉴 «전자결재»가 보인다.
2. `https://chairman-os-eosin.vercel.app/e-approval/admin` — 양식 여섯 · 전결 규칙(1천만 원 이상 구매 · 지출 · 수리 = 대표 승인). 필요하면 고친다.

## 5) 회사 직원에게 켜기 (대표가 고를 때)

`https://chairman-os-eosin.vercel.app/settings/features` → «전자결재» → 회사 줄(예: DY) → 켜짐 · 범위 «전원» · 이유 → 저장.
그 회사 사람의 사이드바에 «전자결재»가 서고, 예전 «전자결재»(/approvals — 결재 요청 · 결재 대장)는 이름이 «결재 요청»으로 바뀐다(화면 · 기능은 그대로).

## 홈 위젯 연결(0086 직원 홈이 부를 함수)

`src/lib/approvals/widget.ts` — 메뉴와 같은 함수(DB `ea_counts` · `ea_list`)·같은 권한:

| 함수 | 돌려주는 것 | 누르면 |
|---|---|---|
| `myApprovalPendingCount()` | 내 결재 대기 건수 = «결재할 문서» 탭 숫자(결재 예정은 안 셈) · 0087 없는 DB면 `null` | `eaTodoHref` = `/e-approval?box=todo` |
| `myApprovalPendingList(limit = 5)` | 내 차례 문서(`EaListRow[]`) | `eaDocHref('todo', doc_id)` |
| `mySubmittedApprovals(limit = 5)` | 내가 올린 문서(임시저장 빼고 · 상태 · 지금 담당자 `current_label`) | `eaDocHref('mine', doc_id)` |

승인 · 반려 뒤 서버 액션이 `/e-approval` · `/me`를 다시 그리게 한다(`revalidatePath`) — 위젯과 메뉴 숫자가 같이 바뀐다.

## 되돌리는 길

- 화면만: `https://chairman-os-eosin.vercel.app/settings/features` → «전자결재» 끄기(그룹 줄 · 회사 줄) → 메뉴 · 화면이 사라지고 DB 함수도 거부(문서 · 이력은 그대로 남는다).
- DB를 걷는 일은 하지 않는다(결재 기록이 남아야 한다). 꼭 필요하면 이 문서의 0087 표 이름(`ea_*`)으로 별도 블록에서.

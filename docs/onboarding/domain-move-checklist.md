# 운영 도메인 이전 체크리스트 — `groupware.dyindustrial.com` (초안 · 2026-10-02 · 실행 전)

지금: `https://chairman-os-eosin.vercel.app`. 순서는 **새 도메인 추가(옛것과 나란히) → 기준값 전환 · 재배포 → 확인 → 약 2주 뒤 옛 도메인을 새 도메인으로 리디렉트 · 옛 URI 제거**.
옛 메일 링크와 폰에 설치된 앱이 그동안 살아 있게 하려는 순서다.

## 회장이 할 것 (대시보드)

| # | 어디 | 할 일 | 확인 |
|---|---|---|---|
| 1 | dyindustrial.com DNS | `CNAME groupware → cname.vercel-dns.com`(Vercel이 보여 주는 값 그대로) | `nslookup groupware.dyindustrial.com` · Vercel «Valid Configuration» · SSL 발급 |
| 2 | Vercel → Domains | groupware.dyindustrial.com을 Production에 추가, vercel.app은 당분간 유지. 4단계에서 옛 도메인을 «Redirect to …»(308) | 두 주소 모두 열림 |
| 3 | Vercel → Production env | `APP_BASE_URL=https://groupware.dyindustrial.com`(끝 `/` 없이) · `KAKAO_REDIRECT_URI=https://groupware.dyindustrial.com/api/kakao/callback` · `GOOGLE_REDIRECT_URI`는 따로 넣었을 때만. `NEXT_PUBLIC_*`는 그대로 → Redeploy | `curl -s https://groupware.dyindustrial.com/api/health` (OPERATIONS 9절 12번) |
| 4 | Supabase production → Auth → URL Configuration | **먼저** Redirect URLs에 `https://groupware.dyindustrial.com/**` 추가(옛것 유지) → **그다음** Site URL을 새 주소로. 메일 템플릿은 `{{ .SiteURL }}`이라 따라온다 | 초대된 테스트 주소로 `/signup` → 메일 링크가 새 도메인 → `/me`. PC 가입 → 폰에서 링크 한 번 더 |
| 5 | Resend (메일 발신을 dyindustrial.com으로 옮길 때만) | 도메인 추가 · SPF/DKIM(+DMARC) DNS → Verified → Supabase SMTP Sender `no-reply@dyindustrial.com` | 가입 메일이 스팸함이 아닌 곳에 도착. 앱 이전과 따로 해도 된다 |
| 6 | Kakao Developers | Redirect URI에 `…/api/kakao/callback` 추가(KOE006 방지 — 환경변수와 글자까지 같게) · 플랫폼 → Web 사이트 도메인에 새 주소 | `/settings/chairman`에서 카카오 다시 연결 → 아침 브리핑 링크 눌러 보기 |
| 7 | Kakao i 오픈빌더 스킬 | URL을 `https://groupware.dyindustrial.com/api/kakao/skill?key=<KAKAO_SKILL_SECRET>`로 | 채널에서 메시지 → 답 · 링크 |
| 8 | Google Cloud OAuth (Gmail 읽기 · `/mail`, 회장 전용) | 리디렉트 URI `…/api/google/callback` · JS origin 추가 · 동의 화면 Authorized domains에 dyindustrial.com(도메인 확인 필요할 수 있음) | `/mail`에서 Gmail 연결 → 연결됨으로 돌아옴 |
| 9 | GitHub → 저장소 secret `APP_URL` | 새 주소(끝 `/` 없이) | Actions «chairman morning tick» 수동 실행 → 200/204 |

**사람들이 겪는 것:** 로그인 쿠키가 도메인마다 따로라 **모두 한 번 다시 로그인**한다(MFA 등록은 그대로). 폰 홈 화면에 설치한 앱은 옛 주소에 묶여 있어 **지우고 새 주소에서 다시 추가**한다.
인증 앱의 TOTP 발급자 이름은 Site URL 호스트를 따른다 — 새로 등록하는 사람부터 새 이름, 기존 항목은 옛 이름으로 계속 동작.

## 코드에서 바꿀 것

- **src/에는 하드코딩된 주소가 없다.** 전부 `APP_BASE_URL`(없으면 요청 origin)을 읽는다 — signup.ts:43 · google auth/callback · kakao auth/callback · google/kakao config · kakao assistant · send-brief.
- `next.config.ts`: CSP에 자기 origin이 없어 변경 없음. Cloudflare 프록시처럼 Host를 바꾸는 층을 앞에 두면 `serverActions.allowedOrigins`에 새 도메인 추가.
- `.env.example:55 · :61` — 예시 값.
- `docs/OPERATIONS.md` — :46 주소 표 · :73-74 KAKAO_REDIRECT_URI · APP_BASE_URL · :713 APP_URL secret. 1절에 «도메인 이전» 소절을 둔다(이 문서 링크).
- `docs/onboarding/staff-ko.md:3 · :9` 주소 · 가입 링크 → `staff-ko.pdf` 다시 생성(`scripts/onboarding-pdf.mjs`).
- 그대로 둘 것: 지난 계획 문서 속 옛 주소(기록).

## 전환 뒤 확인

OPERATIONS 9절 배포 후 확인 4단계를 새 도메인으로 · 로그아웃 상태에서 `/` · `/approvals` · `/settings/users` → `/login` · 가입 메일 → `/auth/confirm` → `/me` ·
카카오 브리핑 링크 · 스킬 답 · Gmail 연결 · GitHub tick → 이상 없으면 옛 도메인을 리디렉트로.

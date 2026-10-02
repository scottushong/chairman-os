# 인증 메일 한국어 템플릿 (초안 · 2026-10-02)

Supabase 대시보드 **Authentication → Emails**에 회장이 직접 붙여 넣는다. 앱은 메일을 보내지 않는다(D-15).
staging에 먼저 넣고 초대된 테스트 주소로 한 번씩 받아 본 뒤 production에 같은 내용을 넣는다.

| 템플릿 | 언제 나가나 | 링크 |
|---|---|---|
| **Confirm signup** | 직원이 `/signup`에서 초대된 이메일을 넣었을 때 | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` (현재 production 설정 그대로) |
| **Invite user** | 회장이 대시보드 Users → **Invite user**로 보낼 때 | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` |

- 두 링크 모두 `/auth/confirm` → `/auth/set-password`(12자 이상) → 역할에 맞는 첫 화면으로 간다. `/auth/confirm`은 `type`을 그대로
  `verifyOtp`에 넘기므로 초대 메일은 **`type=invite`**여야 한다(`email`로 두면 초대 토큰이 풀리지 않는다).
- 기본 링크(`{{ .ConfirmationURL }}`)는 쓰지 않는다 — PKCE라 가입을 시작한 브라우저에서만 풀린다(OPERATIONS 3-1 5번).
- **초대 메일도 앱의 초대가 먼저다.** `/settings/users`에서 초대를 저장한 뒤에 대시보드 Invite user를 누른다(OPERATIONS 3절 ①).
  0043 Hook이 켜진 뒤에는 앱 초대가 없는 주소로의 Invite user가 거절된다.
- 만료 시간은 **Authentication → Providers → Email → Email OTP Expiration** 값이다(기본 3600초 = 1시간). 본문의 «1시간»은
  그 값을 바꾸면 같이 고친다.

---

## 1. Confirm signup — 가입 확인

**제목**

```
[DY 그룹웨어] 가입 확인 — 아래 버튼을 눌러 주세요
```

**본문 (HTML)**

```html
<div style="margin:0;padding:24px 0;background:#f4f4f5;font-family:'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;">
        <tr><td style="padding:32px 28px 8px;font-size:13px;letter-spacing:1px;color:#71717a;">DY 그룹웨어</td></tr>
        <tr><td style="padding:0 28px;font-size:20px;font-weight:700;color:#18181b;line-height:1.4;">가입 확인</td></tr>
        <tr><td style="padding:16px 28px 0;font-size:15px;color:#3f3f46;line-height:1.7;">
          안녕하세요.<br>
          <b>{{ .Email }}</b> 주소로 DY 그룹웨어 가입을 시작하셨습니다.<br>
          아래 버튼을 누르면 이메일 확인이 끝나고, 이어서 비밀번호를 정하는 화면으로 이동합니다.
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email"
             style="display:inline-block;padding:14px 28px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
            이메일 확인하고 비밀번호 정하기
          </a>
        </td></tr>
        <tr><td style="padding:0 28px;font-size:13px;color:#71717a;line-height:1.7;">
          · 링크는 <b>1시간</b> 동안, 한 번만 쓸 수 있습니다. 시간이 지났으면 로그인 화면의 «처음이세요?»에서 다시 시작해 주세요.<br>
          · PC에서 가입을 시작하고 휴대폰에서 이 메일을 열어도 괜찮습니다.<br>
          · 비밀번호는 12자 이상이며, 이 메일이나 다른 어떤 메일로도 비밀번호를 묻지 않습니다.
        </td></tr>
        <tr><td style="padding:24px 28px 32px;font-size:12px;color:#a1a1aa;line-height:1.6;border-top:1px solid #f4f4f5;">
          본인이 가입을 시작하지 않았다면 이 메일을 무시해 주세요. 계정은 만들어지지 않습니다.<br>
          문의: 소속 회사 경영지원 담당자
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>
```

---

## 2. Invite user — 초대

**제목**

```
[DY 그룹웨어] 초대가 도착했습니다
```

**본문 (HTML)**

```html
<div style="margin:0;padding:24px 0;background:#f4f4f5;font-family:'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:12px;">
        <tr><td style="padding:32px 28px 8px;font-size:13px;letter-spacing:1px;color:#71717a;">DY 그룹웨어</td></tr>
        <tr><td style="padding:0 28px;font-size:20px;font-weight:700;color:#18181b;line-height:1.4;">DY 그룹웨어에 초대되었습니다</td></tr>
        <tr><td style="padding:16px 28px 0;font-size:15px;color:#3f3f46;line-height:1.7;">
          안녕하세요.<br>
          <b>{{ .Email }}</b> 주소로 DY 그룹웨어 계정이 준비되었습니다.<br>
          아래 버튼을 눌러 비밀번호를 정하면 바로 시작할 수 있습니다.
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite"
             style="display:inline-block;padding:14px 28px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;">
            초대 수락하고 비밀번호 정하기
          </a>
        </td></tr>
        <tr><td style="padding:0 28px;font-size:13px;color:#71717a;line-height:1.7;">
          · 링크는 <b>1시간</b> 동안, 한 번만 쓸 수 있습니다. 시간이 지났으면 초대해 주신 분께 다시 요청해 주세요.<br>
          · 비밀번호는 12자 이상입니다. 처음 들어가면 «내 홈»이 열립니다.<br>
          · 이 메일이나 다른 어떤 메일로도 비밀번호를 묻지 않습니다.
        </td></tr>
        <tr><td style="padding:24px 28px 32px;font-size:12px;color:#a1a1aa;line-height:1.6;border-top:1px solid #f4f4f5;">
          초대받을 일이 없었다면 이 메일을 무시하고 경영지원 담당자에게 알려 주세요.
        </td></tr>
      </table>
    </td></tr>
  </table>
</div>
```

---

## 넣은 뒤 확인 (staging → production)

1. 초대된 테스트 주소로 `/signup` → 메일 제목 · 한글 깨짐 · 버튼 링크가 `…/auth/confirm?token_hash=…&type=email`인지(메일 앱에서 링크 길게 누르기).
2. 버튼 → `/auth/set-password` → 비밀번호 → `/me`.
3. Invite user를 쓸 계획이면 같은 방식으로 한 번(`type=invite`). 앱 초대 없이 보내면 Hook(켜졌을 때)이 거절하는 것이 정상이다.

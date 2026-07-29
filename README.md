# EdgeLogger - Cloudflare Workers 로깅 프록시

Cloudflare Workers를 사용하여 HTTP 요청과 응답을 실시간으로 로깅하는 프록시 서비스입니다.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Gyegyung/edgelogger-pub)

## 📋 개요

EdgeLogger는 HTTP 트래픽을 가로채서 요청/응답의 헤더와 본문을 콘솔에 로깅합니다.
`LOG_COVERAGE` 환경 변수로 어떤 부분을 로깅할지 설정할 수 있습니다.
디버깅과 API 모니터링에 유용한 도구입니다.

## ✨ 주요 기능

- **실시간 로깅**: 모든 HTTP 요청/응답을 실시간으로 캡처
- **로그 범위 설정**: `LOG_COVERAGE`로 헤더/본문 로깅 범위를 자유롭게 설정
- **가독성 높은 로그**: 구분선과 들여쓰기로 페이로드를 쉽게 읽을 수 있는 형식
- **고유 요청 ID**: CF-Ray 헤더 또는 UUID를 사용한 요청 추적
- **다양한 Content-Type 지원**: JSON, 텍스트, 폼 데이터 등
- **투명한 프록시**: 요청/응답을 수정 없이 그대로 전달

## 🚀 시작하기

### 필수 조건

- Node.js 18+
- npm 또는 yarn
- Cloudflare 계정
- Wrangler CLI

### 설치

1. 저장소 클론:
```bash
git clone https://github.com/Gyegyung/edgelogger-pub.git
cd edgelogger-pub
```

2. 의존성 설치:
```bash
npm install
```

3. Wrangler 로그인:
```bash
npx wrangler login
```

### 개발 환경 실행

로컬 개발 서버 시작:
```bash
npm run start
# 또는
npx wrangler dev
```

개발 서버는 기본적으로 `http://localhost:8787`에서 실행됩니다.

### 배포

Cloudflare Workers에 배포:
```bash
npm run deploy
# 또는
npx wrangler deploy
```

## 📁 프로젝트 구조

```
edgelogger-pub/
├── src/
│   └── index.ts              # 메인 워커 코드
├── wrangler.example.toml     # 설정 템플릿 (git 포함)
├── wrangler.toml             # 실제 설정 (git 제외)
├── package.json              # 프로젝트 의존성
├── tsconfig.json             # TypeScript 설정
├── .gitignore                # Git 제외 파일
└── README.md                 # 프로젝트 문서
```

## 🔧 설정

### wrangler.toml

`wrangler.toml`은 실제 도메인 정보를 포함하므로 git에서 제외됩니다.
`wrangler.example.toml`을 복사하여 사용하세요:

```bash
cp wrangler.example.toml wrangler.toml
```

그런 다음 `wrangler.toml`을 열고 라우트와 로그 범위를 설정합니다:

```toml
name = "edgelogger-pub"
main = "src/index.ts"
compatibility_date = "2024-09-14"

[vars]
LOG_COVERAGE = "full"

[[routes]]
pattern = "your.subdomain.com/path*"
zone_name = "yourdomain.com"
```

### 라우트(Route) vs 커스텀 도메인(Custom Domain)

기존 웹 서버가 있는 경우 **Route**를 사용해야 합니다.

| 구분 | Route | Custom Domain |
|------|-------|---------------|
| 패턴 | `subdomain.com/path*` (경로 포함) | `subdomain.com` (도메인만) |
| 기존 서버 | 특정 경로만 Worker가 가로채고 나머지는 기존 서버로 전달 | Worker가 원본 서버가 되어 기존 서버 대체 |
| 사용 상황 | 기존 웹 서버에 로깅 추가 | Worker 단독으로 서비스할 때 |

**주의:** `zone_name`에 지정한 도메인은 Cloudflare DNS에서 프록시(주황색 구름 아이콘)가 활성화되어 있어야 합니다.

`workers.dev` 서브도메인만 사용하려면 `[[routes]]` 블록 없이 배포하면 됩니다.

## 📊 LOG_COVERAGE 설정

`LOG_COVERAGE` 환경 변수로 어떤 페이로드를 로깅할지 설정합니다.
`wrangler.toml`의 `[vars]` 섹션에서 지정합니다.

```toml
[vars]
LOG_COVERAGE = "full"
```

### 설정값

| 값 | 요청 헤더 | 요청 본문 | 응답 헤더 | 응답 본문 | 설명 |
|----|:---------:|:---------:|:---------:|:---------:|------|
| `req_headers` | ✓ | | | | 요청 헤더만 |
| `req_full` | ✓ | ✓ | | | 요청 헤더 + 본문 |
| `res_headers` | | | ✓ | | 응답 헤더만 |
| `res_full` | | | ✓ | ✓ | 응답 헤더 + 본문 |
| `headers` | ✓ | | ✓ | | 요청/응답 헤더만 |
| `full` | ✓ | ✓ | ✓ | ✓ | 전체 (기본값) |

설정하지 않으면 `full`로 동작합니다.

## 📋 로그 형식

각 섹션은 구분선으로 구분되어 페이로드를 쉽게 읽을 수 있습니다.

```
════════════════════════════════════════════════════════════
  [abc123-ICN] POST /logging
  coverage: full
════════════════════════════════════════════════════════════

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [abc123-ICN] POST /logging  ◀ REQUEST HEADERS
────────────────────────────────────────────────────────────
  content-type  application/json
  user-agent    curl/7.88.1
  cf-ray        abc123-ICN

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [abc123-ICN] POST /logging  ◀ REQUEST BODY
────────────────────────────────────────────────────────────
  {
    "name": "홍길동",
    "email": "hong@example.com"
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [abc123-ICN] POST /logging  ▶ RESPONSE HEADERS
────────────────────────────────────────────────────────────
  status: 200 OK
  content-type  application/json

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [abc123-ICN] POST /logging  ▶ RESPONSE BODY
────────────────────────────────────────────────────────────
  {
    "id": 123,
    "name": "홍길동",
    "created": true
  }
```

- `◀` — 요청(Request)
- `▶` — 응답(Response)
- 요청 ID는 모든 섹션에서 동일하여 같은 요청의 로그를 쉽게 추적 가능

## 🛠️ 개발

### 로컬 테스트

```bash
# 개발 서버 시작
npm run start

# 다른 터미널에서 테스트 요청
curl -X POST http://localhost:8787/logging \
  -H "Content-Type: application/json" \
  -d '{"message": "안녕하세요"}'
```

### TypeScript 컴파일

```bash
npx tsc --noEmit
```

## 📝 지원되는 Content-Type

| Content-Type | 처리 방식 |
|---|---|
| `application/json` | JSON으로 파싱 후 들여쓰기 포맷 출력 |
| `application/x-www-form-urlencoded` | 키-값 쌍으로 출력 |
| `multipart/form-data` | 키-값 쌍으로 출력 |
| 기타 모든 타입 | 텍스트로 처리 |

## 🔍 로그 확인

Cloudflare Workers 대시보드에서 실시간 로그를 확인할 수 있습니다:

1. [Cloudflare 대시보드](https://dash.cloudflare.com) 접속
2. Workers & Pages 섹션으로 이동
3. edgelogger-pub 워커 선택
4. "Logs" 탭에서 실시간 로그 확인

또는 터미널에서 실시간으로 확인:
```bash
npx wrangler tail
```

## 🚨 주의사항

- **민감한 데이터**: 설정된 범위에 따라 요청/응답 데이터가 로깅됩니다. 프로덕션 환경에서는 `LOG_COVERAGE`를 최소 범위로 설정하고 민감한 정보가 노출되지 않도록 주의하세요.
- **성능**: 본문 로깅(`req_full`, `res_full`, `full`)은 본문을 읽는 추가 작업이 발생합니다. 트래픽이 많은 환경에서는 `headers` 모드 사용을 권장합니다.
- **로그 보존**: Cloudflare Workers 로그는 제한된 시간 동안만 보존됩니다.

## 🤝 기여하기

1. 이 저장소를 포크합니다
2. 기능 브랜치를 생성합니다 (`git checkout -b feature/새기능`)
3. 변경사항을 커밋합니다 (`git commit -am '새 기능 추가'`)
4. 브랜치에 푸시합니다 (`git push origin feature/새기능`)
5. Pull Request를 생성합니다

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.

## 🆘 지원

문제가 발생하거나 질문이 있으시면 [Issues](https://github.com/Gyegyung/edgelogger-pub/issues)에 등록해 주세요.

## 🔗 관련 링크

- [Cloudflare Workers 문서](https://developers.cloudflare.com/workers/)
- [Wrangler CLI 문서](https://developers.cloudflare.com/workers/wrangler/)
- [TypeScript 문서](https://www.typescriptlang.org/docs/)

---

**EdgeLogger**로 HTTP 트래픽을 쉽게 모니터링하고 디버깅하세요!

# AI Adversarial Obfuscator

JavaScript 난독화와 **AI 기반 코드 분석 교란용 마커**를 결합한 독립 구현입니다. CLI와 Vite 8 플러그인을 제공합니다.

ACODA(*Adversarial Code Obfuscation for Defending against LLM-based Analysis*, ICSE-Companion 2026)의 접근에서 아이디어를 얻었지만, 원본 구현을 복사하거나 그 논문의 성공률을 재현했다고 주장하지 않습니다. [ACODA 논문](https://arxiv.org/abs/2606.11755) · [원본 저장소](https://github.com/security-pride/Acoda)

## 제공 기능

- `javascript-obfuscator` 기반 식별자 변경, 문자열 배열/인코딩, 수식 변형
- `balanced`/`strong` 모드에서 제어 흐름 평탄화, `strong`에서 dead code injection
- 생물학·범죄·테러·성적 콘텐츠 관련 **비기능적** 미끼 식별자와 주석 (용어 변경 가능)
- AI 분석 중단을 유도하는 경고 주석 또는 중립적 topic 마커 선택
- 응답 종료 특수 토큰 형태의 주석 마커
- 고정된 시드에 따른 재현 가능한 결과
- CLI 단일 파일, 디렉터리, stdin/stdout 지원
- Vite 8 프로덕션 번들, 코드 분할 및 동적 import 지원
- 파일별 크기·SHA-256을 담은 JSON 리포트. **AI 분석 차단률은 측정하지 않음**

실제 악성코드나 실행 가능한 취약점 코드는 추가하지 않습니다. 미끼 코드는 `if (false)` 블록 안에 존재하며 실행되지 않습니다. 기존 기능 유지가 목표이지만, 모든 JavaScript 프로그램의 관측 가능한 동등성을 증명하는 도구는 아닙니다.

## 요구 사항

- Node.js 20.19 이상 (개발·검증 환경: Node.js 24.22.1)
- Vite 플러그인 사용 시 Vite 8 (검증 환경: 8.3.6)
- `npm ci`에서 의존성 설치 가능

```bash
cd ai-adversarial-obfuscator
npm ci
npm test
npm run test:types
```

## CLI

```bash
# 단일 파일. 원본은 수정하지 않으며, 출력이 이미 존재하면 실패합니다.
node bin/ai-obfuscate.mjs input.js -o input.protected.js --preset balanced

# 폴더 전체의 .js/.mjs/.cjs만 재귀적으로 처리
node bin/ai-obfuscate.mjs ./src -o ./protected --preset strong --seed 12345

# 사용자 정의 용어/중립적인 마커/리포트
node bin/ai-obfuscate.mjs app.js -o app.obf.js \
  --mode topic --terms "BioHazard,CrimeScenario,OtherSensitiveTopic" \
  --report report.json

# 기존 일반 JS 난독화만 실행
node bin/ai-obfuscate.mjs input.js -o input.obf.js --no-adversarial

# CJS/Node.js 코드에 맞춘 설정
node bin/ai-obfuscate.mjs service.cjs -o service.obf.cjs --target node

# 표준입출력 스트림
node bin/ai-obfuscate.mjs - -o - --preset light < input.js > output.js
```

파일 덮어쓰기를 허용하려면 `--force`를 명시하세요. 입력 경로와 출력 경로가 겹치면 중단합니다. 심볼릭 링크는 추적하지 않습니다. `--help`로 전체 인자를 확인할 수 있습니다.

프로젝트에 로컬 패키지로 설치한 후에는 `npx ai-obfuscate` 명령도 사용할 수 있습니다.

## Vite 플러그인

압축파일의 패키지 디렉터리를 기준으로 다른 Vite 프로젝트에서 다음처럼 설치합니다.

```bash
npm install -D /path/to/ai-adversarial-obfuscator
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { aiAdversarialObfuscator } from 'ai-adversarial-obfuscator/vite';

export default defineConfig({
    plugins: [
        // Vue/React/Svelte 등 다른 변환 플러그인은 이 앞에 배치
        aiAdversarialObfuscator({
            preset: 'balanced', // light | balanced | strong
            mode: 'refusal',   // refusal | topic
            seed: 2026,
            exclude: /vendor/, // 특정 chunk 제외 (선택)
            reportFile: 'ai-obfuscation-report.json' // false로 끌 수 있음
        })
    ],
    build: {
        minify: false,
        sourcemap: false
    }
});
```

```bash
npm run build
```

Vite 8/Rolldown이 `renderChunk` 결과를 다시 처리하면서 주석이나 불가능한 분기를 없앨 수 있으므로, 플러그인은 두 단계로 동작합니다.

1. `renderChunk`: 문자열과 제어 흐름 난독화. 출력 파일의 콘텐츠 해시 계산에 반영됩니다.
2. Rolldown의 `output.postBanner`/`output.postFooter`: 마지막 렌더링 뒤에 미끼 문구와 미실행 식별자를 다시 삽입합니다. 결과 번들의 콘텐츠 해시에도 반영됩니다.

`build.minify`를 `false`로 두지 않거나 `build.sourcemap`을 활성화하면 보호 효과와 무결성 문제를 방지하기 위해 **빌드가 오류로 중단**됩니다. 난독화 라이브러리가 자체 압축·변형을 수행하지만 결과 크기는 상당히 커질 수 있습니다.

`src/*.d.mts`에 공개 API의 TypeScript 선언이 포함되어 있어 `vite.config.ts`에서도 옵션 타입을 확인할 수 있습니다.

### 옵션

| 옵션 | 기본값 | 의미 |
| --- | --- | --- |
| `preset` | `balanced` | `light`, `balanced`, `strong` |
| `seed` | `1337` | 양의 정수, 재현성 |
| `adversarial` | `true` | `false`면 일반 난독화만 |
| `mode` | `refusal` | `refusal`은 경고문, `topic`은 중립적 마커 |
| `terms` | 4개 기본 용어 | 1~16개 문자열 배열 |
| `target` | `browser` | `browser` 또는 `node` |
| `include` / `exclude` | 없음 | Vite chunk 이름 조건: 문자열, RegExp, 함수, 배열 |
| `reportFile` | `ai-obfuscation-report.json` | JSON 보고서 경로 또는 `false` |

리포트 크기는 난독화 변환 단계 기준입니다. 출력 후반부 주석과 Vite의 재렌더링으로 인해 최종 디스크 파일 크기와 다를 수 있습니다.

## 프리셋별 특징

| 프리셋 | 문자열 인코딩 | 제어 흐름 평탄화 | 일반 더미 코드 | 비용 |
| --- | --- | --- | --- | --- |
| `light` | 문자열 배열 | 없음 | 없음 | 상대적으로 작음 |
| `balanced` | Base64 문자열 배열 | 일부 | 없음 | 중간 |
| `strong` | Base64, 문자열 분할 | 더 적극적 | 일부 | 높음 |

`strong`은 크기와 실행 비용이 늘어나므로 민감한 모듈에 선별 적용하는 것을 권장합니다. `selfDefending`, 개발자 도구 차단, `renameProperties`처럼 프레임워크나 디버깅을 쉽게 망가뜨릴 수 있는 옵션은 의도적으로 사용하지 않습니다.

## 빌드·실행 검증

```bash
npm test
npm run test:types
npm run build:fixture
```

테스트는 다음을 확인합니다.

- 세 가지 프리셋의 JavaScript ESM 결과가 원본 함수와 동일한 값을 반환하는지
- CLI로 난독화한 Node.js CJS 파일을 **실제 Node 프로세스에서 실행**할 수 있는지
- CLI 폴더 입력, 표준입출력, 덮어쓰기 방지, 보고서 생성
- Vite 8이 여러 번들을 생성하고 동적 import가 정상 실행되는지 (Node ESM import로 실행 검증)
- 난독화 마커가 최종 빌드에 남고, 마커만 달라져도 콘텐츠 해시가 달라지는지
- 특정 chunk 제외, 소스맵·후속 minify 구성 거부

자동 테스트를 통과하더라도 브라우저별 CSP, Web Workers, Service Workers, SSR, `eval`/동적 프로퍼티 접근 등은 프로젝트별로 별도 검증해야 합니다. 현재 포함된 Vite 실행 테스트는 Node의 ESM 로더를 사용하며 실제 브라우저 E2E 테스트는 포함하지 않았습니다.

## 보호 모델과 한계

이 도구는 **난독화를 통한 분석 비용 증가**와 **일부 LLM에서의 분석 거부/오분석 가능성**을 노립니다. 코드가 브라우저에서 실행되는 이상 추적·수정·동적 분석은 가능하며, 기밀 정보·API 키·핵심 알고리즘 비밀을 클라이언트 번들에 넣어서는 안 됩니다.

주석과 미실행 코드는 AST 정규화나 재번들링으로 제거할 수 있습니다. 민감한 용어는 보안 스캐너·배포 플랫폼에서 오탐을 낼 수 있습니다. 이 구현의 LLM 공격 성공률(ASR)은 평가하지 않았고, ACODA 논문의 최대 70%라는 수치를 본 도구의 성능으로 인용해서는 안 됩니다.

저장소는 [MIT 라이선스](LICENSE)의 독립 코드이며, 사용 라이브러리에는 각각의 라이선스가 적용됩니다. 원본 ACODA 코드가 포함되어 있지는 않습니다.

# AI Adversarial Obfuscator

[English](README.md) · [한국어](README.ko.md)

JavaScript 난독화에 비기능적 마커를 선택적으로 추가하여 LLM 기반 코드 분석을 실험하는 도구입니다. ESM API, CLI, TypeScript 선언과 Vite 8 플러그인을 제공합니다.

[`javascript-obfuscator`](https://github.com/javascript-obfuscator/javascript-obfuscator)에 주석, 미끼 식별자와 실행되지 않는 코드를 결합합니다. **LLM 분석에 대한 저항성은 측정하지 않았습니다.** 보고서는 변환 결과와 파일 크기를 기록하며, 분석을 차단할 수 있다는 증거를 제공하지 않습니다.

## 주요 기능

- `light`, `balanced`, `strong` 세 가지 프리셋
- 시드, 입력, 파일 컨텍스트와 의존성 버전이 같을 때 재현 가능한 변환
- 분석 중단을 요청하는 `refusal` 주석 또는 중립적인 `topic` 마커와 사용자 정의 용어
- 단일 파일, 디렉터리 트리와 stdin/stdout을 지원하는 CLI
- 코드 분할과 동적 import를 사용하는 Vite 프로덕션 빌드 지원
- 바이트 수와 SHA-256 해시를 담은 JSON 보고서
- 마커를 끄고 일반 JavaScript 난독화만 수행하는 옵션

마커 블록은 `if (false)` 안에 있으며, 용어가 가리키는 작업을 실행하지 않습니다. 난독화는 애플리케이션의 기존 동작 유지를 목표로 하지만, 실제 출력물을 사용하는 애플리케이션에서 호환성을 검증해야 합니다.

## 시작하기

**Node.js 22.12 이상**이 필요하며, 개발에는 **Node.js 24 LTS**를 권장합니다. Vite 연동은 **Vite 8**을 대상으로 하며, 코어 API와 CLI에는 Vite 애플리케이션이 필요하지 않습니다.

접근 권한이 있는 GitHub 계정으로 저장소를 복제합니다.

```bash
git clone https://github.com/seo-rii/ai-adversarial-obfuscator.git
cd ai-adversarial-obfuscator
npm ci
npm test
npm run test:types
```

저장소는 현재 비공개입니다. 코드는 MIT 라이선스이며, 실수로 npm에 게시하지 않도록 패키지에 `private`이 설정되어 있습니다. 아래 사용법은 공개 npm 레지스트리에 패키지가 게시되어 있다고 가정하지 않습니다.

다른 프로젝트에서 사용하려면 로컬 체크아웃 경로로 설치합니다.

```bash
# 위 체크아웃에서 npm ci를 마친 뒤, 사용할 프로젝트에서 실행합니다.
npm install -D /absolute/path/to/ai-adversarial-obfuscator
```

## CLI 사용법

이 저장소에서 다음 명령을 실행합니다.

```bash
# 단일 파일. 기본적으로 출력 파일이 이미 있으면 실패합니다.
node bin/ai-obfuscate.mjs input.js -o input.protected.js --preset balanced

# .js, .mjs, .cjs 파일을 재귀적으로 변환합니다.
node bin/ai-obfuscate.mjs ./src -o ./protected --preset strong --seed 12345

# 사용자 정의 용어, 중립적인 마커와 JSON 보고서
node bin/ai-obfuscate.mjs app.js -o app.obf.js \
  --mode topic --terms "ExampleTopic,ReviewMarker" --report report.json

# 마커 없이 일반 난독화만 수행합니다.
node bin/ai-obfuscate.mjs input.js -o input.obf.js --no-adversarial

# Node.js/CommonJS 대상 설정
node bin/ai-obfuscate.mjs service.cjs -o service.obf.cjs --target node

# 표준입출력
node bin/ai-obfuscate.mjs - -o - --preset light < input.js > output.js

node bin/ai-obfuscate.mjs --help
```

다른 프로젝트에 로컬 패키지를 설치했다면 `npx --no-install ai-obfuscate`로 설치된 CLI를 실행할 수 있습니다.

`-o`를 생략하면 파일은 `input.obfuscated.js`로, 디렉터리는 같은 상위 경로의 `<input>-obfuscated`로 출력합니다. 디렉터리 처리 시 JavaScript 파일만 복사하므로 필요한 다른 자산은 별도로 복사해야 합니다. CLI는 `node_modules`, `.git`, `.vite`를 건너뛰며 입력 심볼릭 링크를 따라가지 않습니다. 입력과 출력 경로는 겹칠 수 없습니다. 기존 출력 파일을 덮어쓰려면 `--force`를 지정합니다.

CLI 보고서는 파일별 변환 보고서의 배열입니다. 진행 상황과 오류는 stderr로 출력하므로 stdout으로 변환된 코드를 전달할 수 있습니다.

## 프로그램에서 사용하기

패키지는 ESM 형식입니다. Node.js 빌드 스크립트에서 코어 API를 가져옵니다.

```js
import { writeFile } from 'node:fs/promises';
import { obfuscateWithReport } from 'ai-adversarial-obfuscator';

const source = 'export function add(a, b) { return a + b; }';
const { code, report } = obfuscateWithReport(
    source,
    { preset: 'light', seed: 2026, mode: 'topic' },
    { fileName: 'math.js' }
);

await writeFile('math.protected.mjs', code);
console.log(report.beforeBytes, report.afterBytes);
```

루트 진입점은 문자열만 반환하는 `obfuscateSource(source, options, context)`와 `normalizeOptions(options)`, `createAdversarialBlock(options, context)`, `DEFAULT_TERMS`, `PRESETS`도 제공합니다. TypeScript 선언은 `src/*.d.mts`에 포함되어 있습니다.

## Vite 플러그인

Vite 8 프로젝트에 로컬 패키지를 설치한 뒤 `vite.config.ts`에 추가합니다.

```ts
import { defineConfig } from 'vite';
import { aiAdversarialObfuscator } from 'ai-adversarial-obfuscator/vite';

export default defineConfig({
    plugins: [
        // 프레임워크 변환 플러그인은 이 플러그인 앞에 배치합니다.
        aiAdversarialObfuscator({
            preset: 'balanced',
            mode: 'topic',
            seed: 2026,
            exclude: /vendor/,
            reportFile: 'ai-obfuscation-report.json'
        })
    ],
    build: {
        minify: false,
        sourcemap: false
    }
});
```

사용하는 애플리케이션의 일반 빌드 명령(예: `npm run build`)을 실행합니다.

플러그인은 프로덕션 빌드에 적용됩니다. `renderChunk`에서 청크를 난독화하고, Rolldown의 `postBanner`와 `postFooter`에서 최종 마커를 삽입하여 마지막 렌더링 이후에도 마커가 남고 콘텐츠 해시에 반영되도록 합니다. `.js`와 `.mjs` 청크를 처리합니다.

**`build.minify: false`와 `build.sourcemap: false`를 설정해야 합니다.** `adversarial`이 `false`인 경우에도 다른 minify 설정이나 활성화된 소스맵은 오류로 거부합니다. 난독화기가 자체적으로 코드를 압축합니다. 이후 처리 도구는 마커를 제거하거나 결과를 변경할 수 있습니다.

## 옵션

코어 API와 Vite 플러그인은 다음 옵션을 공유합니다. CLI에서는 대응하는 플래그를 사용하며, 마커를 끄려면 `--no-adversarial`을 지정합니다.

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `preset` | `balanced` | `light`, `balanced`, `strong` 중 선택 |
| `seed` | `1337` | 양의 안전한 정수 |
| `adversarial` | `true` | 미끼 식별자, 주석과 실행되지 않는 마커를 포함 |
| `mode` | `refusal` | `refusal`은 분석 중단 요청, `topic`은 중립적인 마커 문구. 두 방식 모두 효과를 측정하지 않음 |
| `terms` | 기본 용어 4개 | 비어 있지 않은 문자열 1~16개의 배열. 각 용어는 최대 80자이며 제어 문자와 주석 종료 문자를 정리함 |
| `target` | `browser` | 난독화기의 실행 대상인 `browser` 또는 `node` |

Vite 전용 옵션:

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `include` / `exclude` | 미설정 | 청크 파일명을 부분 문자열, `RegExp`, 판별 함수 또는 이들의 배열로 비교. 제외 조건 우선 |
| `reportFile` | `ai-obfuscation-report.json` | 상대 경로의 `.json` 자산 이름. 보고서를 끄려면 `false` |

각 코어 보고서는 `fileName`, 선택된 옵션, `sourceSha256`, `outputSha256`, `beforeBytes`, `afterBytes`, `sizeRatio`, `evaluation: 'not-performed'`를 포함합니다. Vite 보고서는 청크 이름과 함께 이를 `chunks`에 기록합니다. Vite 수치는 `renderChunk` 변환 단계 기준이므로 출력 훅과 렌더링을 거친 최종 파일의 바이트 수·해시와 다를 수 있습니다.

## 프리셋

| 프리셋 | 문자열 처리 | 제어 흐름 평탄화 | 더미 코드 삽입 | 예상 비용 |
| --- | --- | --- | --- | --- |
| `light` | 문자열 배열 | 비활성화 | 비활성화 | 낮음 |
| `balanced` | Base64 문자열 배열 | 부분 적용 | 비활성화 | 중간 |
| `strong` | Base64 문자열 배열과 문자열 분할 | 더 적극적으로 적용 | 활성화 | 높음 |

마커 블록은 변환 프리셋과 별도로 제어합니다. `strong`은 번들 크기와 실행 비용을 크게 늘릴 수 있습니다. 구현에서는 프로퍼티 이름 변경, 전역 이름 변경, self-defending 출력, 디버거 방해와 콘솔 차단을 사용하지 않습니다.

## 개발과 검증

```bash
npm ci
npm test
npm run test:types
npm run build:fixture
npm pack --dry-run
```

테스트는 모든 프리셋, 재현 가능한 출력, 옵션 검증, CLI 파일·디렉터리·스트림 처리, CJS 실행, Vite 청크 import, 동적 import, 마커 유지, 콘텐츠 해시, 제외 조건과 빌드 설정 거부를 확인합니다. Vite 실행 테스트는 Node의 ESM 로더를 사용하며 브라우저 E2E 테스트는 아닙니다. 기록된 환경과 결과는 [VALIDATION.md](VALIDATION.md)를 참고하세요.

```text
bin/                    CLI 진입점
src/core.mjs            코어 변환과 보고서
src/vite.mjs            Vite 프로덕션 빌드 플러그인
src/*.d.mts             공개 TypeScript 선언
test/                   런타임·타입 검사
fixtures/vite/          소규모 Vite 연동 애플리케이션
```

## 적용 범위와 한계

난독화는 코드 파악을 어렵게 할 수 있지만, 클라이언트 코드는 여전히 추적·수정·동적 분석할 수 있습니다. 배포하는 JavaScript에 인증 정보나 다른 비밀을 포함하지 마세요.

주석과 실행되지 않는 코드는 AST 정규화나 재번들링으로 제거할 수 있습니다. 기본 용어가 보안 스캐너나 플랫폼의 오탐을 유발할 수 있으므로 상황에 맞게 용어를 바꾸거나 마커를 비활성화하세요. LLM의 분석 거부율, 역공학 비용과 특정 모델에 대한 보호 효과는 평가하지 않았습니다.

CSP 요구 사항, 브라우저 동작, SSR, Web Workers, Service Workers, 리플렉션과 동적 생성 코드는 사용하는 애플리케이션에서 검증해야 합니다. 포함된 테스트를 통과해도 모든 JavaScript 프로그램과의 호환성이 입증되지는 않습니다.

## 기여, 보안과 라이선스

개발 절차는 [CONTRIBUTING.md](CONTRIBUTING.md), 취약점 제보는 [SECURITY.md](SECURITY.md), 변경 이력은 [CHANGELOG.md](CHANGELOG.md)를 참고하세요.

[ACODA](https://github.com/security-pride/Acoda)의 접근에서 아이디어를 얻은 독립 구현이며, ACODA 저자와 관련이 없습니다. 다른 구현의 결과를 재현했다고 주장하지 않습니다.

[MIT 라이선스](LICENSE)를 적용합니다. 각 의존성에는 해당 의존성의 라이선스가 적용됩니다.

# AI Adversarial Obfuscator

[English](README.md) · [한국어](README.ko.md)

JavaScript 난독화에 비기능적 마커를 선택적으로 추가하여 LLM 기반 코드 분석을 실험하는 도구입니다. ESM API, CLI, TypeScript 선언과 Vite 8 플러그인을 제공합니다.

[`javascript-obfuscator`](https://github.com/javascript-obfuscator/javascript-obfuscator)에 주석, 미끼 식별자와 실행되지 않는 코드를 결합합니다. **LLM 분석에 대한 저항성은 측정하지 않았습니다.** 보고서는 변환 결과와 파일 크기를 기록하며, 분석을 차단할 수 있다는 증거를 제공하지 않습니다.

## 주요 기능

- `light`, `balanced`, `strong` 세 가지 프리셋
- 시드, 입력, 파일 컨텍스트와 의존성 버전이 같을 때 재현 가능한 변환
- 분석 중단을 요청하는 `refusal` 주석 또는 중립적인 `topic` 마커와 사용자 정의 용어
- 파일·디렉터리·stdin/stdout, 소스맵, JSON 설정, 파일 필터와 쓰기 없는 계획·검사를 지원하는 CLI
- minify, 소스맵, 코드 분할과 동적 import를 사용하는 Vite 프로덕션 빌드 지원
- 청크별 Vite 정책과 반복 빌드를 위한 용량 제한 변환 캐시
- 최종 raw/gzip/Brotli 크기, SHA-256 해시와 CI 출력 예산을 담은 보고서
- 마커를 끄고 일반 JavaScript 난독화만 수행하는 옵션

마커 블록은 `if (false)` 안에 있으며, 용어가 가리키는 작업을 실행하지 않습니다. 난독화는 애플리케이션의 기존 동작 유지를 목표로 하지만, 실제 출력물을 사용하는 애플리케이션에서 호환성을 검증해야 합니다.

## 시작하기

**Node.js 22.12 이상**이 필요하며, 개발에는 **Node.js 24 LTS**를 권장합니다. Vite 연동은 **Vite 8**을 대상으로 하며, 코어 API와 CLI에는 Vite 애플리케이션이 필요하지 않습니다.

저장소를 복제합니다.

```bash
git clone https://github.com/seo-rii/ai-adversarial-obfuscator.git
cd ai-adversarial-obfuscator
npm ci
npm test
npm run test:types
```

코드는 MIT 라이선스입니다. 실수로 npm에 게시하지 않도록 패키지에 `private`이 설정되어 있으며, 이 설정은 GitHub 저장소 공개 여부와 별개입니다. 아래 사용법은 공개 npm 레지스트리에 패키지가 게시되어 있다고 가정하지 않습니다.

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

`--force`를 사용해도 출력·보고서 파일의 심볼릭 링크와 입력 파일을 가리키는 별칭 경로는 거부합니다. 보고서는 출력 디렉터리 트리 밖에 저장해야 합니다. 모든 저장 경로를 확인한 뒤 출력을 시작합니다.

CLI 보고서는 파일별 변환 보고서의 배열입니다. 진행 상황과 오류는 stderr로 출력하므로 stdout으로 변환된 코드를 전달할 수 있습니다.

### 소스맵

```bash
# 출력 옆에 .map 파일을 만들고 sourceMappingURL 주석을 추가합니다.
node bin/ai-obfuscate.mjs app.js -o app.obf.js --sourcemap true

# JavaScript에 링크를 넣지 않고 별도 맵을 저장합니다.
node bin/ai-obfuscate.mjs app.js -o app.obf.js \
  --sourcemap hidden --sourcemap-file ./maps/app.js.map

# 스트림은 맵을 포함하거나 외부 맵 경로를 명시할 수 있습니다.
node bin/ai-obfuscate.mjs - -o - --sourcemap inline < app.js > app.obf.js
```

`--sourcemap`은 `false`(기본값), `true`, `inline`, `hidden`을 받습니다. 디렉터리 입력의 외부 맵은 각 출력 파일 옆에 저장하며, `--sourcemap-file`은 단일 파일 또는 stdin에만 사용합니다. stdin에서 외부 맵을 생성하려면 이 경로를 명시해야 합니다. 맵 저장 경로에도 JavaScript·보고서와 같은 충돌 검사와 입력 보호를 적용합니다. CLI 보고서의 크기·해시는 맵 링크나 inline 맵을 붙이기 전 코어 변환 기준입니다.

### 설정, 필터와 실행 계획

`--config`로 JSON 파일을 명시합니다. 실행 가능한 JavaScript 설정 파일은 불러오지 않습니다. 예를 들어 `obfuscator.config.json`:

```json
{
  "input": "./src",
  "output": "./protected",
  "preset": "light",
  "mode": "topic",
  "terms": ["ProjectMarker"],
  "include": ["**/*.js", "**/*.mjs"],
  "exclude": ["**/*.test.*"],
  "sourcemap": "hidden",
  "report": "./reports/obfuscation.json"
}
```

```bash
node bin/ai-obfuscate.mjs --config ./obfuscator.config.json --preset balanced
node bin/ai-obfuscate.mjs ./src -o ./protected --exclude '**/*.test.*' --dry-run
node bin/ai-obfuscate.mjs --config ./obfuscator.config.json --check
```

우선순위는 기본값, 설정 파일, 명시한 CLI 값 순입니다. JSON 안의 경로는 설정 파일 기준, 명령행 경로는 현재 작업 디렉터리 기준입니다. 중첩 없는 설정 객체에 `preset`, `seed`, `mode`, `terms`, `target`, `adversarial`, `input`, `output`, `report`, `sourcemap`, `sourcemapFile`, `include`, `exclude`를 지정할 수 있습니다. 여기서는 코어 API의 `sourceMap` 대신 `sourcemap`을 사용합니다. 기존 파일 교체 허용은 CLI의 `--force`로만 지정합니다.

파일 필터는 입력 루트 기준의 POSIX 형식 상대 경로에 glob 패턴을 적용하며 제외 조건이 우선합니다. `--dry-run`은 변환·쓰기 없이 JSON 저장 계획을 출력합니다. `--check`는 변환까지 수행해 구문·옵션 오류를 확인하지만 입력 코드를 실행하거나 파일을 쓰지는 않습니다. 두 옵션은 경로 안전 검사를 유지하며 서로 함께 사용할 수 없고, stdin 대신 파일·디렉터리 입력에 적용합니다.

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

소스맵이 필요하면 `obfuscateWithReport`에 `sourceMap: true`를 전달합니다. 반환값의 `map`은 결과 코드를 입력 코드에 연결합니다. 미끼 블록은 뒤에 추가하여 directive prologue, hashbang과 매핑된 코드의 위치를 보존합니다. 기본값은 `null`입니다. 코어 API는 파일을 쓰거나 `sourceMappingURL` 주석을 추가하지 않으므로 호출자가 소스맵을 저장하고 연결해야 합니다. CLI와 Vite 연동은 각 옵션에 맞게 저장·연결을 처리합니다.

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
            chunkOptions(chunk) {
                if (chunk.moduleIds.some(id => id.endsWith('/sensitive.js'))) {
                    return { preset: 'strong' };
                }
                return chunk.isEntry ? { preset: 'light' } : undefined;
            },
            budgets: { maxGzipBytes: 500_000, maxGrowthRatio: 12 },
            reportFile: 'ai-obfuscation-report.json'
        })
    ],
    build: {
        minify: true, // 생략하면 Vite 기본값을 사용합니다.
        sourcemap: 'hidden'
    }
});
```

사용하는 애플리케이션의 일반 빌드 명령(예: `npm run build`)을 실행합니다.

Worker 프로덕션 빌드에는 `worker: { plugins: () => [aiAdversarialObfuscator({ preset: 'balanced' })] }`처럼 별도의 플러그인 팩터리가 필요합니다. 메인·Worker 설정 예시는 [브라우저 fixture](fixtures/browser/vite.config.mjs)를 참고하세요.

플러그인은 프로덕션 빌드의 `.js`와 `.mjs` 청크를 처리합니다. 순서를 지정한 `renderChunk` 훅에서 minify 이후에 난독화를 적용하고, Rolldown의 `postBanner`와 `postFooter`에서 최종 마커를 삽입합니다. 변환 결과와 최종 마커가 콘텐츠 해시에 반영되어 청크 참조와 동적 import를 유지합니다. 난독화에서 제외한 청크에도 설정된 minify는 적용됩니다.

`build.minify`는 Vite 기본값, `true`, `'oxc'`, `false`, `'esbuild'`, `'terser'`를 지원합니다. 기본 Oxc minify는 난독화 바로 앞의 별도 청크 훅에서 실행하고, Vite의 esbuild·Terser 훅도 난독화 훅보다 먼저 실행됩니다. 선택한 추가 백엔드는 사용하는 프로젝트에서 `npm install -D esbuild` 또는 `npm install -D terser`로 설치해야 합니다. `minify: false`여도 난독화기는 자체 출력 코드를 압축합니다.

소스맵은 Vite 설정을 자동으로 따르며, 별도의 플러그인 옵션이나 수동 순서 조정이 필요하지 않습니다. minify와 난독화는 별도의 순서 지정 `renderChunk` 훅에서 실행하며, 각 훅은 자신이 수행한 변환의 맵만 반환합니다. Rolldown의 기본 소스맵 파이프라인이 전체 변환을 원본 모듈까지 연결하고 요청한 형식으로 출력합니다.

| `build.sourcemap` | 출력 |
| --- | --- |
| `false` | 소스맵을 생성하지 않음 |
| `true` | 별도 `.map` 파일과 `sourceMappingURL` 주석 |
| `'inline'` | JavaScript 안에 data URL로 포함한 소스맵 |
| `'hidden'` | `sourceMappingURL` 주석 없이 별도 `.map` 파일 |

맵 파일명, 기본 URL, 원본 경로 변환, ignore list, debug ID와 원본 내용 제외 등 Rolldown 출력 옵션도 Rolldown이 그대로 처리합니다.

소스맵은 원본 코드를 노출할 수 있습니다. `'hidden'`은 링크만 생략하며 배포한 `.map` 파일을 비공개로 만들지는 않습니다. 오류 수집 서비스에 업로드할 소스맵은 비공개로 보관하세요. 이후 처리 도구가 마커나 출력을 바꿀 수 있으므로 추가 변환이 있다면 소스맵 연결도 유지해야 합니다.

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

코어 API에서는 `sourceMap: true`(기본값: `false`)를 추가로 지정하여 `obfuscateWithReport`에서 소스맵을 반환받을 수 있습니다. Vite에서는 대신 `build.sourcemap`을 설정합니다.

Vite 전용 옵션:

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `include` / `exclude` | 미설정 | 청크 파일명을 부분 문자열, `RegExp`, 판별 함수 또는 이들의 배열로 비교. 제외 조건 우선 |
| `chunkOptions` | 미설정 | 청크별 옵션 객체, 건너뛰기용 `false`, 전역 옵션 상속용 `undefined`를 반환하는 동기 콜백 |
| `budgets` | 미설정 | 전체 출력의 합계 한도. 아래 설명 참고 |
| `cache` | `true` | 메모리 변환 캐시. `false`, `true` 또는 `{ maxEntries, maxBytes }` |
| `reportFile` | `ai-obfuscation-report.json` | 상대 경로의 `.json` 자산 이름. 보고서를 끄려면 `false` |

`chunkOptions`는 읽기 전용 `name`, 예비 `fileName`, `moduleIds`, `isEntry`, `isDynamicEntry`, `facadeModuleId`를 받습니다. 전역 include/exclude 필터가 먼저 적용되고, 선택된 청크마다 출력 생성당 한 번 콜백을 호출합니다. 같은 결정값을 변환과 최종 마커에 사용합니다. `false`를 반환하면 난독화와 마커는 건너뛰되 설정된 minify는 유지합니다. 정책은 청크 전체에 적용하므로 모듈을 따로 처리하려면 번들러의 코드 분할 설정을 사용하세요.

### 보고서와 CI 예산

Vite 보고서는 `schemaVersion: 2` 형식입니다.

- `chunks`: 변환한 청크의 코어 수치, `transformMs`, `cacheHit`와 최종 `emitted` 수치
- `files`: 제외한 청크를 포함한 모든 JavaScript의 최종 파일명, raw/gzip/Brotli 바이트 수, SHA-256과 소스맵 바이트 수
- `totals`: 출력별 합계. 경고 모드에서 한도를 넘겨도 빌드를 계속하면 `budgetViolations`에 기록
- `cache`: 현재 출력 생성의 hit·miss·eviction 수와 캐시에 남아 있는 항목·데이터 바이트 수

기존 코어 수치인 `fileName`, 선택된 옵션, `sourceSha256`, `outputSha256`, `beforeBytes`, `afterBytes`, `sizeRatio`, `evaluation: 'not-performed'`도 유지합니다. Vite에서는 minify 이후 입력과 `renderChunk` 변환 결과를 나타냅니다. 렌더링·마커·맵 링크를 포함한 최종 수치는 별도로 제공합니다. `mapBytes`는 inline 맵을 디코딩한 데이터 또는 별도 맵 파일의 크기이며, inline JavaScript 크기에는 인코딩된 맵이 이미 포함됩니다. 처리 시간은 진단용이므로 동일한 빌드에서도 달라질 수 있습니다.

`budgets`는 `maxBytes`, `maxGzipBytes`, `maxBrotliBytes`, `maxGrowthRatio`와 `onExceeded: 'error'`(기본값) 또는 `'warn'`을 받습니다. 한도는 제외한 청크를 포함한 출력별 전체 JavaScript 합계에 적용합니다. 증가율은 최종 JavaScript 바이트 수를 minify 이후 입력 바이트 수로 나눈 값입니다. `reportFile: false`여도 예산 검사는 동작하며, 별도 맵 파일의 크기는 JavaScript 예산과 구분해 보고합니다. 이 수치는 출력 비용이며 보안 효과나 실행 속도를 측정하지 않습니다.

### 반복 빌드 캐시

기본 캐시는 플러그인 인스턴스마다 최대 128개 항목과 32 MiB의 직렬화된 변환 데이터를 보관합니다. `maxBytes`는 이 데이터의 한도이며 JavaScript 힙 전체의 사용량을 제한하지는 않습니다. `cache: { maxEntries: 64, maxBytes: 8 * 1024 * 1024 }`로 양의 정수 한도를 바꾸거나 `cache: false`로 끌 수 있습니다. 크기를 제한한 LRU 캐시는 입력, 유효 청크 옵션, 파일 컨텍스트, 출력 형식과 소스맵 모드가 같으면 코드·맵·코어 보고서를 재사용합니다. 같은 플러그인 인스턴스의 watch 재빌드와 반복 빌드에 유지되며 프로세스가 끝나면 사라집니다. 정책 콜백은 출력 생성마다 다시 호출하고, hit의 처리 시간은 현재 조회·해시·복제 작업을 측정합니다.

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

# 별도의 실제 브라우저 검사(Chromium 전용)
npx playwright install chromium --only-shell
npm run test:browser
```

Node 테스트는 프리셋, 재현성, CLI 안전성·설정·맵·계획, 청크 정책, 최종 보고서·예산, 캐시, minify, 콘텐츠 해시와 소스맵 위치를 확인합니다. 별도의 Chromium fixture에서는 `unsafe-eval`·`unsafe-inline` 없는 CSP 아래에서 원본과 변환 앱의 DOM 조작, 기본 preload, 동적 import와 실제 Worker 결과를 비교합니다. 기록된 환경과 검증 범위는 [VALIDATION.md](VALIDATION.md)를 참고하세요.

```text
bin/                    CLI 진입점
src/core.mjs            코어 변환과 보고서
src/vite.mjs            Vite 프로덕션 빌드 플러그인
src/*.d.mts             공개 TypeScript 선언
test/                   런타임·타입 검사
fixtures/vite/          소규모 Vite 연동 애플리케이션
fixtures/browser/       DOM·동적 import·Worker·CSP fixture
test/browser/           별도 Chromium 검사
```

## 적용 범위와 한계

난독화는 코드 파악을 어렵게 할 수 있지만, 클라이언트 코드는 여전히 추적·수정·동적 분석할 수 있습니다. 배포하는 JavaScript에 인증 정보나 다른 비밀을 포함하지 마세요.

주석과 실행되지 않는 코드는 AST 정규화나 재번들링으로 제거할 수 있습니다. 기본 용어가 보안 스캐너나 플랫폼의 오탐을 유발할 수 있으므로 상황에 맞게 용어를 바꾸거나 마커를 비활성화하세요. LLM의 분석 거부율, 역공학 비용과 특정 모델에 대한 보호 효과는 평가하지 않았습니다.

CSP 요구 사항, 브라우저 동작, SSR, Web Workers, Service Workers, 리플렉션과 동적 생성 코드는 사용하는 애플리케이션에서 검증해야 합니다. 포함된 테스트를 통과해도 모든 JavaScript 프로그램과의 호환성이 입증되지는 않습니다.

LLM 평가는 구현하거나 실행하지 않았습니다. 기능·크기 검사는 모델 제공자 호출이나 측정된 분석 거부율·정답률을 제공하지 않습니다.

## 기여, 보안과 라이선스

개발 절차는 [CONTRIBUTING.md](CONTRIBUTING.md), 취약점 제보는 [SECURITY.md](SECURITY.md), 변경 이력은 [CHANGELOG.md](CHANGELOG.md)를 참고하세요.

[ACODA](https://github.com/security-pride/Acoda)의 접근에서 아이디어를 얻은 독립 구현이며, ACODA 저자와 관련이 없습니다. 다른 구현의 결과를 재현했다고 주장하지 않습니다.

[MIT 라이선스](LICENSE)를 적용합니다. 각 의존성에는 해당 의존성의 라이선스가 적용됩니다.

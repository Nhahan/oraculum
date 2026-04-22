<p align="right">
  <a href="./README.md">English</a> | <strong>한국어</strong>
</p>

# Oraculum

<p align="center">
  <img src="https://raw.githubusercontent.com/Nhahan/oraculum/main/docs/images/logo.png" alt="Oraculum logo" width="320">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/oraculum">
    <img src="https://img.shields.io/npm/v/oraculum?color=blue" alt="npm">
  </a>
  <a href="https://github.com/Nhahan/oraculum/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="License">
  </a>
</p>

<p align="center">
  <strong>여러 후보를 겨루게 하고, 판정(verdict)을 읽고, 추천된 결과만 최종 반영(crown)합니다.</strong>
  <br />
  <sub>Claude Code와 Codex를 위한 오라클 기반(oracle-guided) chat-native consultation 워크플로우 도구</sub>
</p>

<p align="center">
  <a href="#개요">개요</a> ·
  <a href="#설치">설치</a> ·
  <a href="#빠른-시작">빠른 시작</a> ·
  <a href="#동작-방식">동작 방식</a> ·
  <a href="#고급-사용법">고급 사용법</a>
</p>

---

## 개요

Oraculum은 AI 구현 작업을 한 번에 적용하는 흐름이 아니라, 후보들이 겨루는 토너먼트로 바꿉니다.

각 후보는 격리된 작업 공간에서 실행되고, 레포지토리의 검사들이 오라클처럼 판정하며, 근거가 기록되고, 추천된 결과만 최종 반영됩니다.

Claude Code나 Codex가 여러 패치 후보를 먼저 시도해 보게 하고, 어떤 결과를 채택할지 로컬 검사와 저장된 근거로 결정하고 싶을 때 사용하는 도구입니다.

일반 Git 프로젝트나 비-Git 프로젝트 폴더에서도 사용할 수 있고, Oraculum을 npm으로 설치했다고 해서 대상 레포지토리가 Node 프로젝트일 필요는 없습니다.

## 설치

npm에서 설치합니다.

```bash
npm install -g oraculum
```

그 다음 사용하는 호스트에 맞게 Oraculum을 등록합니다.

Claude Code:

```bash
oraculum setup --runtime claude-code
```

Codex:

```bash
oraculum setup --runtime codex
```

이 `oraculum setup ...` 명령은 일반 터미널에서 실행해야 합니다.
그리고 현재 디렉토리 전용 설정이 아니라, 로컬 Claude Code나 Codex 설치 전체에 대해 전역(host-level) 등록을 수행합니다.

나중에 연결 상태를 다시 확인하고 싶다면:

```bash
oraculum setup status
```

## 빠른 시작

사용하는 호스트에 맞게 Oraculum을 등록합니다.

```bash
oraculum setup --runtime codex
oraculum setup --runtime claude-code
```

그 다음 Claude Code나 Codex에 들어가서 아래처럼 사용합니다.

```text
orc consult "fix session loss on refresh"
```

이 흐름은 처음 사용할 때 Oraculum을 자동 초기화하고, consultation이 끝나면 결과 요약을 바로 출력합니다.

나중에 최근 추천 결과를 실제로 반영하려면:

```text
orc crown fix/session-loss
```

Git 프로젝트에서는 `crown`이 지정한 브랜치를 만들고 추천된 결과를 그 브랜치에 반영합니다. Git이 아닌 프로젝트에서는 `orc crown`만 사용하면 되고, 가짜 브랜치 이름 없이 해당 결과를 프로젝트 폴더에 그대로 동기화합니다.

검증 공백, fallback-policy 추천, second-opinion manual-review 압력이 남아 있으면 `crown`은 기본적으로 중단됩니다. 사람이 검토한 뒤에는 `orc crown --allow-unsafe`로 명시적으로 override할 수 있고, 그 기록은 export plan에 남습니다.

채팅 네이티브 planning 명령은 입력 표면을 task 전용으로 유지합니다. 빠른 시작 기본값은 `.oraculum/config.json`에, 고급 프로젝트 정책은 `.oraculum/advanced.json`에 두고, 작업별 요구사항은 task 문장에 포함하세요. 레포지토리 로컬 oracle 명령은 `.oraculum/advanced.json` 안에서 자체 `timeoutMs`를 계속 가질 수 있습니다.

더 넓거나 위험한 작업을 먼저 shape하고 싶다면 `orc plan "<task>"`를 사용하세요. plan 요청이 아직 불명확하면 Oraculum은 실행 가능한 plan을 만들기 전에 하나의 구체적인 clarification을 묻습니다. 답변은 task 문장에 포함해서 `orc plan`을 다시 실행하세요. 준비되면 재사용 가능한 `consultation-plan.json`, `plan-readiness.json`, 사람이 읽기 쉬운 `consultation-plan.md`를 저장하고, 나중에 `orc consult <plan-artifact>`로 다시 실행할 수 있습니다. `orc draft`는 같은 planning lane에 대한 호환 alias로 남아 있습니다.

가장 최근 실행 결과를 나중에 다시 열어보거나, 예전 실행을 조회하거나, 기록 보관함을 살펴보거나, 셸 전용 setup, uninstall, diagnostics, MCP 명령이 필요하다면 [고급 사용법](./docs/advanced-usage.md)을 참고하세요.

## 동작 방식

1. Oraculum에 하나의 작업을 입력합니다.
2. Oraculum이 여러 후보 구현을 만듭니다.
3. 각 후보는 독립된 작업 공간에서 실행됩니다.
4. 단계별 검사로 약한 후보를 제거합니다.
5. 추천 결과를 제시하고, 그 근거를 남기고, 마지막으로 최종 반영할 수 있게 합니다.

결과는 `.oraculum/` 아래에 저장됩니다. 기준이 되는 것은 채팅 기록이 아니라 verdict review, finalist comparison, research brief, failure analysis를 포함한 저장된 실행 상태와 산출물입니다.

## 고급 사용법

런타임 선택, 후보 수 조정, consultation 기록 조회, 레포지토리 로컬 검사, research artifact, setup 진단, repo-local oracle timeout 같은 제어가 필요하면 [고급 사용법](./docs/advanced-usage.md)을 참고하세요. 빠른 시작용 기본값은 `.oraculum/config.json`에, 고급 프로젝트 설정은 `.oraculum/advanced.json`에 둡니다.

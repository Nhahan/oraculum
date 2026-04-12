<p align="right">
  <a href="https://github.com/Nhahan/oraculum/blob/main/README.md">English</a> | <strong>한국어</strong>
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
  <strong>여러 패치를 겨루게 하고, 판정(verdict)을 읽고, 끝까지 살아남은 결과만 최종 반영(crown)합니다.</strong>
  <br />
  <sub>Claude Code와 Codex를 위한 오라클 기반(oracle-guided) chat-native 패치 워크플로우 도구</sub>
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

Oraculum은 AI 패치를 한 번에 적용하는 작업이 아니라, 후보들이 겨루는 토너먼트로 바꿉니다.

각 후보는 격리된 작업 공간에서 실행되고, 레포지토리의 검사들이 오라클처럼 판정하며, 근거가 기록되고, 끝까지 살아남은 후보만 최종 반영됩니다.

Claude Code나 Codex는 추론 런타임으로 남고, Oraculum은 그 주변에 격리, 검사, 근거 기록, 최종 반영 게이트 같은 결정적 하네스를 제공합니다.

npm은 Oraculum의 배포 채널일 뿐입니다. 대상 레포지토리가 Node 프로젝트일 필요는 없습니다.

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

이 `oraculum setup ...` 명령은 Claude Code나 Codex 채팅창이 아니라 일반 터미널에서 실행해야 합니다.
그리고 현재 디렉토리 전용 설정이 아니라, 로컬 Claude Code나 Codex 설치 전체에 대해 전역(host-level) 등록을 수행합니다.

나중에 연결 상태를 다시 확인하고 싶다면:

```bash
oraculum setup status
```

## 빠른 시작

터미널에서 설정을 마친 뒤에는 Claude Code나 Codex 채팅창으로 돌아가 아래 host-native 흐름을 사용합니다.

```text
orc consult "fix session loss on refresh"
orc crown fix/session-loss
```

이 흐름은 처음 사용할 때 Oraculum을 자동 초기화하고, 실행이 끝나면 결과 요약을 바로 출력합니다. `crown`은 추천된 후보가 있는 가장 최근 실행 결과를 기본값으로 사용합니다.

Git 프로젝트에서는 `crown`이 지정한 브랜치를 만들고 선택된 후보를 그 브랜치에 적용합니다. Git이 아닌 프로젝트에서는 `orc crown`만 사용하면 되고, 가짜 브랜치 이름 없이 해당 작업 공간 내용을 프로젝트 폴더에 그대로 동기화합니다.

가장 최근 실행 결과를 나중에 다시 열어보거나, 예전 실행을 조회하거나, 기록 보관함을 살펴보거나, setup/MCP/디버깅용 셸 명령이 필요하다면 [고급 사용법](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md)을 참고하세요.

## 동작 방식

1. Oraculum에 하나의 작업을 입력합니다.
2. Oraculum이 여러 후보 패치를 만듭니다.
3. 각 후보는 독립된 작업 공간에서 실행됩니다.
4. 단계별 검사로 약한 후보를 제거합니다.
5. 끝까지 살아남은 후보를 추천하고, 그 근거를 남기고, 마지막으로 최종 반영할 수 있게 합니다.

결과는 `.oraculum/` 아래에 저장됩니다. 기준이 되는 것은 채팅 기록이 아니라 저장된 실행 상태와 산출물입니다.

## 고급 사용법

프로필 선택, 런타임 선택, 실행 기록 조회, 레포지토리에 정의한 오라클 설정, setup 진단, MCP 연결, host uninstall 방법 같은 제어가 필요하면 [고급 사용법](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md)을 참고하세요. 빠른 시작용 기본값은 `.oraculum/config.json`에, 운영자용 제어는 `.oraculum/advanced.json`에 둡니다.

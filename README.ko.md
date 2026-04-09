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

Oraculum은 Claude Code와 Codex를 위한 오라클 기반(oracle-guided) 패치 워크플로우 도구입니다.

제품이 목표로 하는 주 표면은 두 호스트에서 공통으로 쓰는 채팅 내부 명령어입니다. 기본 접두사는 `orc`이며, 핵심 흐름은 `orc consult`, `orc verdict`, `orc crown`입니다.

그 아래에서 여러 후보를 격리된 환경에서 실행하고, 레포지토리에 정의한 오라클(repo-local oracle)로 판정하고, 판정(verdict)과 근거(witness)를 남긴 뒤, 마지막으로 끝까지 살아남은 후보만 최종 반영(crown)하도록 만드는 반복 가능한 워크플로우를 제공합니다.

## 설치

npm에서 설치합니다.

```bash
npm install -g oraculum
```

Claude Code용 설정(setup)은 이제 사용할 수 있습니다.

```bash
oraculum setup --runtime claude-code
```

Codex용 chat-native 설정은 아직 작업 중입니다. 그전까지 Codex는 셸 fallback을 사용합니다.

## 빠른 시작

Claude Code에서 설정 후 사용할 host-native 흐름은 아래와 같습니다.

```text
orc consult "fix session loss on refresh"
orc crown fix/session-loss
```

현재 구현 메모:

Claude Code는 설정 후 host-native 경로를 사용할 수 있습니다. Codex는 아직 이 경로를 마무리하는 중이라, 개발/디버그용 shell fallback이 함께 남아 있습니다.

```bash
oraculum consult "fix session loss on refresh"
oraculum crown --branch fix/session-loss
```

위 shell fallback도 같은 기본 흐름을 따릅니다. `consult`는 처음 사용할 때 Oraculum을 자동 초기화하고, 실행이 끝나면 결과 요약을 바로 출력합니다. `crown`은 추천된 후보가 있는 가장 최근 실행 결과를 기본값으로 사용합니다.

Git 프로젝트에서는 `crown`이 브랜치를 만들고 선택된 후보를 그 브랜치에 적용합니다. Git이 아닌 프로젝트에서는 해당 작업 공간 내용을 프로젝트 폴더에 그대로 동기화합니다.

가장 최근 실행 결과를 나중에 다시 열어보거나, 예전 실행을 조회하거나, 기록 보관함을 살펴보고 싶다면 [고급 사용법](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md)을 참고하세요.

## 동작 방식

1. Oraculum에 하나의 작업을 입력합니다.
2. Oraculum이 여러 후보 패치를 만듭니다.
3. 각 후보는 독립된 작업 공간에서 실행됩니다.
4. 단계별 검사로 약한 후보를 제거합니다.
5. 끝까지 살아남은 후보를 추천하고, 그 근거를 남기고, 마지막으로 최종 반영할 수 있게 합니다.

결과는 `.oraculum/` 아래에 저장됩니다. 기준이 되는 것은 채팅 기록이 아니라 저장된 실행 상태와 산출물입니다.

## 고급 사용법

프로필 선택, 런타임 선택, 후보 수 조정, 특정 실행 조회, 보고서 묶음 포함, 레포지토리에 정의한 오라클 설정, 추천 후보 수동 지정 같은 제어가 필요하면 [고급 사용법](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md)을 참고하세요. 빠른 시작용 기본값은 `.oraculum/config.json`에, 운영자용 제어는 `.oraculum/advanced.json`에 둡니다.

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
  <strong>경쟁하는 패치를 consult하고, verdict를 읽고, 마지막 생존 결과만 crown합니다.</strong>
  <br />
  <sub>Claude Code와 Codex를 위한 oracle-guided 패치 consultation 도구</sub>
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

Oraculum은 코드베이스와 AI 코딩 런타임 사이에 위치하는 로컬 설치형 워크플로우 도구입니다.

AI가 처음 제시한 패치를 그대로 믿는 대신, 여러 후보 패치를 생성하고 검사한 뒤 살아남은 결과만 남기도록 돕습니다.

## 설치

npm에서 설치합니다.

```bash
npm install -g oraculum
```

## 빠른 시작

작업하려는 프로젝트 폴더에서:

```bash
oraculum consult "fix session loss on refresh"
oraculum crown --branch fix/session-loss
```

이것이 기본 흐름입니다. `consult`는 처음 사용할 때 Oraculum을 자동 초기화하고, consultation을 실행한 뒤 verdict 요약을 바로 출력합니다. `crown`은 추천 survivor가 있는 가장 최근 consultation을 기본값으로 사용합니다.

Git 프로젝트에서는 `crown`이 브랜치를 만들고 survivor를 그 브랜치에 적용합니다. Git이 아닌 프로젝트에서는 survivor workspace를 프로젝트 폴더로 동기화합니다.

가장 최근 consultation을 나중에 다시 열어보거나, 이전 consultation을 조회하거나, consultation 기록을 탐색하고 싶다면 [고급 사용법](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md)을 참고하세요.

## 동작 방식

1. Oraculum에 하나의 작업을 입력합니다.
2. Oraculum이 여러 후보 패치를 만듭니다.
3. 각 후보는 독립된 workspace에서 실행됩니다.
4. 단계별 검사로 약한 후보를 제거합니다.
5. 최종 생존 후보를 추천하고, verdict 근거를 남기고, crown할 수 있게 합니다.

결과는 `.oraculum/` 아래에 저장됩니다. 기준이 되는 것은 채팅 transcript가 아니라 저장된 run 상태와 artifact입니다.

## 고급 사용법

consultation-scoped profile selection, 런타임 선택, 후보 수 조정, 특정 consultation 조회, report packaging, repo-local oracle 설정, 추천 survivor 수동 override 같은 제어가 필요하면 [고급 사용법](https://github.com/Nhahan/oraculum/blob/main/docs/advanced-usage.md)을 참고하세요. quick-start 기본값은 `.oraculum/config.json`에, 운영자용 제어는 `.oraculum/advanced.json`에 둡니다.

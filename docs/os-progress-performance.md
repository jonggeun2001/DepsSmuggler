# OS 진행률 전송 빈도 (#189)

OS downloader는 모든 청크의 바이트 진행률을 계속 계산합니다. Electron의 `download-progress.ts`에서 #188 pool이 집계한 최신 payload를 150ms 간격으로 전달합니다. 처음 값은 즉시 전송하고 그 사이 값은 마지막 하나만 보관한 뒤 남은 간격 후 전송합니다. 일반 다운로드의 패키지별 1초 제한과 의존성 해결 전용 채널은 유지합니다.

다음 사건은 간격을 기다리지 않습니다.

- 표시 패키지·단계·패키지 순번/전체 수·처리 완료 수·활성 수의 변경
- 패키지의 첫 바이트 완료, 재시도의 바이트 초기화
- 패키징 단계 메시지 변경과 첫 압축 100%
- 명시적인 `emitOSProgress(payload, true)`

동시 오류는 기존 직렬 오류 창으로 처리합니다. 창을 요청하기 전에 `flushOSProgress()`로 대기 중인 최신 값을 전달하며 오류 자체에는 제한을 적용하지 않습니다. 성공/실패/건너뛰기와 최종 결과 응답도 제한하지 않습니다. 바이트 100%는 전송 완료이며 체크섬 검증·패키징 성공을 뜻하지 않습니다.

`clearOSProgress()`는 timer, 대기 값, 직전 전송 상태를 모두 제거합니다. orchestrator는 새 세션 시작 전에 이를 호출하고 정상/실패 종료 시 마지막 값을 flush한 뒤 정리합니다. 취소 시에는 대기 값을 버립니다. 취소 후 resolver·packager 콜백과 종료된 pool 콜백은 진행률을 재생성하지 않습니다. 정리 이후 새 세션의 첫 값은 즉시 전달됩니다. payload 구조와 화면의 현재 패키지/바이트 의미는 [동시 실행 계약](os-download-concurrency.md)을 유지합니다.

## 재현과 측정

```bash
node scripts/profile-os-progress.mjs e15fddf
```

스크립트는 TypeScript를 메모리에서 읽어 실행하며 앱을 빌드하거나 외부 네트워크를 호출하지 않습니다. 두 실행 모두 현재의 `BaseOSDownloader`와 실제 임시 파일 writer를 사용합니다. 기존 emitter와 새 emitter를 별도 프로세스에서 실행하고 `webContents.send` 경계만 계수용 stub으로 교체합니다. 최종 파일 크기, 마지막 바이트 값, 종료 후 추가 전송 없음도 검사합니다.

2026-09-28, macOS 26.3 / Apple M4 arm64 / Electron 44.3.0 내 Node 24.20.0, 256MiB 응답을 64KiB 청크로 제공한 1회 비교:

| 구분 | 원본 진행 콜백 | 전송 경계 호출 | 다운로드 + 마지막 flush 경과 |
|---|---:|---:|---:|
| `e15fddf` emitter | 4,096 | 4,096 | 122.6ms |
| 150ms 병합 | 4,096 | 2 | 147.4ms |

두 실행 모두 최종 바이트는 268,435,456입니다. 청크 전달 속도·패키지/단계 전환 수에 따라 전송 횟수는 달라집니다. 표는 **send 호출 횟수**이며 실제 Electron IPC 직렬화, React commit, 전체 앱 CPU 또는 네트워크 속도 개선을 측정한 결과가 아닙니다. 빠른 fixture의 경과 시간 차이를 성능 개선으로 해석하지 않습니다.

## 검증

`download-progress-os.test.ts`는 가상 시계로 최초 전송, 정확한 150ms 경계, 최신 값 보존, 즉시 전환, 반복 100%, flush/clear와 창 종료를 검사합니다. `os-download-concurrency.integration.test.ts`는 실제 emitter와 orchestrator를 연결해 취소 중 trailing 전송 제거, 정상 종료 전 마지막 패키징 값 전송, 종료 후 콜백 무시, 오류 창 이전 최신 값 전달을 확인합니다. #188의 동시성 1/3/6, 현재 표시 패키지, 스트림 종료·파일 정리 회귀도 유지합니다. native dialog는 모킹된 경계이며 실제 Electron UI 비용은 별도 검증 대상입니다.

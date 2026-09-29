# npm 저장 파일의 스트림 무결성 검증 (#191)

`NpmDownloader.verifyIntegrity()`는 파일 전체를 `readFile`로 올려 `ssri.checkData`에 전달하던 경로를 `createReadStream`과 `ssri.checkStream`으로 바꿉니다. 다운로드 writer의 종료 뒤 **디스크에 저장된 파일**을 다시 읽어 검증한다는 계약은 유지합니다. 전송 중인 바이트만 검증하는 방식으로 바꾸지 않습니다.

SRI의 알고리즘 우선순위와 같은 알고리즘의 복수 해시 선택은 기존 `ssri`에 맡깁니다. metadata의 integrity가 있으면 SRI만 사용하고, 없거나 빈 문자열이면 기존 SHA1 fallback을 선택합니다. SRI 실패를 SHA1 성공으로 덮어쓰지 않습니다. SHA1 검증 자체는 변경하지 않습니다.

잘못된 SRI·지원하지 않는 알고리즘·파일 누락·읽기/닫기 오류는 `false`를 반환합니다. `checkStream`은 잘못된 SRI에서 reader 오류 listener를 연결하기 전에 실패할 수 있으므로, reader 생성 직후 `finished()`로 오류를 관찰합니다. 모든 경로에서 reader를 정리하고 종료를 기다려 늦은 open 오류와 descriptor 누수를 막습니다. 검증 실패 시 기존 `BaseLanguageDownloader`가 저장 파일을 삭제하며, 이때 SRI reader는 이미 닫힌 상태입니다. 공개 반환 타입·검증 실패 메시지·메타데이터 갱신 시점은 유지합니다.

## 재현

```bash
node scripts/profile-npm-integrity.mjs cf10291
```

스크립트는 측정 전에 64/256MiB 파일과 올바른 SHA512를 생성하고 각 baseline/candidate를 별도 프로세스에서 실행합니다. TypeScript source loader를 메모리에서 사용하므로 앱 빌드·설치·외부 네트워크가 필요 없습니다. 실제 `verifyIntegrity()`의 경과 시간, 프로세스 CPU, RSS/external peak, 1ms timer의 최대 간격을 기록합니다. baseline `checkData` 앞뒤에서도 메모리를 관찰해 동기 해시 중의 파일 버퍼를 놓치지 않도록 합니다. 시작 전 GC 이후 측정하며 검증 중 강제 GC는 사용하지 않습니다.

2026-09-28, macOS 26.3 / Apple M4 arm64 / Electron 44.3.0 내 Node 24.20.0, 크기별 1회 비교:

| 크기/경로 | 경과(ms) | CPU(ms) | 최대 timer 간격(ms) | 추가 RSS(MiB) | 추가 external(MiB) |
|---|---:|---:|---:|---:|---:|
| 64MiB / 기존 | 43.6 | 46.2 | 36.1 | 64.2 | 64.0 |
| 64MiB / 스트림 | 53.2 | 59.9 | 2.1 | 64.9 | 64.1 |
| 256MiB / 기존 | 271.8 | 241.4 | 176.1 | 256.4 | 256.0 |
| 256MiB / 스트림 | 240.7 | 281.2 | 1.7 | 155.2 | 157.8 |

기존 경로는 크기마다 `readFile`과 `checkData` 1회, 변경 경로는 모두 0회입니다. 기존 연속 동기 해시 구간은 64MiB에서 35.4ms, 256MiB에서 175.5ms였습니다. 두 경로 모두 같은 저장 파일의 검증에 성공했습니다.

큰 한 번의 해시 점유가 청크 사이에 나뉘어 timer 응답성이 좋아졌습니다. 256MiB에서는 RSS가 줄었지만 64MiB에서는 개선되지 않았고 두 크기 모두 CPU 사용량은 늘었습니다. 스트림에서 이미 소비한 Buffer도 GC 전까지 외부 메모리에 남을 수 있으므로 프로세스 RSS가 stream highWaterMark 수준으로 제한된다는 뜻은 아닙니다. 수치는 파일 캐시·GC·환경의 영향을 받는 단일 fixture 결과이며 일반 npm 패키지 평균, 다운로드 속도 또는 전체 앱 CPU 개선으로 일반화하지 않습니다.

## 검증

`npm-integrity-streaming.test.ts`는 실제 임시 파일과 `ssri`로 SHA512/SHA256, 더 강한 알고리즘의 우선순위, 같은 알고리즘의 여러 후보, 변조, 빈/잘못된 SRI, 미지원 알고리즘, 파일 누락과 directory 읽기 오류를 검사합니다. 다중 청크 입력의 최대 청크는 64KiB이며 전체 파일 `readFile`과 `checkData`가 호출되지 않는지 확인합니다. 모든 SRI 반환 시 reader가 닫혔는지도 검사합니다.

loopback HTTP 사례는 실제 Axios·저장 writer·SRI reader를 연결합니다. writer 종료 후 검증, SRI/SHA1의 배타적 선택, 불일치 및 잘못된 SRI의 파일 삭제를 확인합니다. 외부 npm Registry와 패키징된 전체 Electron 앱은 이 재현에 포함하지 않습니다.

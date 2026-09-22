# 추가 루트 CA 인증서

회사 네트워크에서 TLS 검사를 수행하면 패키지 검색·다운로드 시 `self signed certificate in certificate chain` 오류가 날 수 있습니다. 회사에서 제공한 CA 인증서를 DepsSmuggler에 등록하면 기본 인증서 검증을 유지하면서 해당 CA도 신뢰합니다.

## 데스크톱 앱

1. **설정 → 추가 루트 CA 인증서 → 인증서 파일 등록**을 선택합니다.
2. 회사의 `.pem`, `.crt`, `.cer` 파일을 선택합니다. 확장자가 아니라 실제 내용을 검사하며 PEM과 DER 형식을 지원합니다.
3. 표시된 인증서 이름·발급자·SHA-256 지문·만료일을 확인합니다.
4. 앱을 완전히 종료한 뒤 다시 실행합니다. macOS에서는 창만 닫지 말고 앱을 종료해야 합니다.

등록·해제는 해당 카드에서 바로 저장됩니다. 화면 상단의 일반 설정 저장 버튼과는 별개입니다. 새 파일 등록은 기존 CA 등록 전체를 교체합니다. 여러 CA가 필요하면 PEM 인증서 블록을 한 파일에 넣어 등록하세요. **등록 해제** 후에도 앱 재시작이 필요합니다.

파일 선택 취소는 기존 등록을 유지합니다. 유효하지 않은 파일이나 저장 실패는 화면에 오류를 표시하고 기존 등록을 보존합니다. 브라우저 개발 화면에는 등록 버튼이 비활성화됩니다.

## CLI

```bash
# PEM 또는 DER 인증서 파일 등록 (기존 등록 교체)
depssmuggler config ca set "/path/to/company-ca.cer"

# 등록된 인증서의 이름·발급자·지문·만료일 조회
depssmuggler config ca get

# 추가 CA 등록 해제
depssmuggler config ca clear
```

Windows 경로도 따옴표로 감싸 전달할 수 있습니다.

```powershell
depssmuggler config ca set "C:\Certificates\company-ca.pem"
```

등록은 **다음 CLI 실행부터** 적용됩니다. 같은 사용자가 실행하는 데스크톱 앱과 CLI는 등록 정보를 공유합니다. 실행 중인 앱에는 재시작 후 적용됩니다. CA 설정이 손상되어 네트워크 명령이 실패해도 `config ca set/clear`로 복구할 수 있습니다. 잘못된 입력과 저장 실패는 CLI 종료 코드 `1`로 보고합니다.

## 저장과 신뢰 범위

- 인증서 사본을 정규화된 PEM으로 `~/.depssmuggler/root-ca.json`에 저장합니다. 등록 후 원본 파일을 이동하거나 삭제해도 됩니다. 운영체제의 인증서 저장소는 변경하지 않습니다.
- CA 인증서만 허용합니다. 서버 인증서, 개인 키가 섞인 PEM, 잘못된 DER, 등록 시점에 유효하지 않은 인증서는 거부합니다. 파일은 최대 1MB, PEM 블록은 최대 100개이며 중복 인증서는 한 번만 저장합니다.
- 일반 설정 저장/초기화와 인증서 등록은 분리되어 있습니다. CA를 없애려면 카드의 **등록 해제** 또는 `config ca clear`를 사용합니다. GUI와 CLI가 동시에 교체하면 마지막 저장이 적용됩니다.
- 앱이 시작할 때 Node 기본 신뢰 목록에 추가합니다. 기본 공개 CA와 이미 적용된 시스템 CA·`NODE_EXTRA_CA_CERTS`는 유지하며 TLS 인증서·호스트 이름 검증을 끄지 않습니다. 진행 중인 연결의 신뢰를 바꾸지 않도록 저장과 적용을 분리합니다.
- 적용 대상은 앱/CLI의 Node 네트워크 요청(Axios, HTTPS, fetch 등)입니다. Chromium 네트워크를 사용하는 자동 업데이트와 외부 브라우저, 생성된 설치 스크립트가 실행되는 다른 PC의 신뢰 설정은 별도입니다.

Node 22.19+/24.5+와 현재 Electron 런타임은 `tls.setDefaultCACertificates()`로 기본 신뢰를 확장합니다. 지원되는 이전 CLI Node 22.13–22.18/24.0–24.4는 기존 환경 CA와 등록 CA를 합친 임시 PEM을 만들어 `NODE_EXTRA_CA_CERTS`를 지정한 자식 프로세스에서 같은 명령을 실행합니다. 임시 파일은 명령 종료 후 제거하고 자식의 종료 코드를 반환합니다. [Node TLS 문서](https://nodejs.org/api/tls.html#tlssetdefaultcacertificatescerts)

## 검증

```bash
bash scripts/verify-worktree.sh \
  src/core/root-ca-store.test.ts \
  src/cli/root-ca.integration.test.ts \
  electron/root-ca-handlers.test.ts \
  src/renderer/pages/settings/RootCaSettingsSection.test.tsx
```

실제 로컬 HTTPS 서버를 사용해 미등록 실패 → CLI 등록 → Axios/HTTPS/fetch 성공 → 해제 후 실패를 확인합니다. 기존 환경 CA 보존, 호스트 이름 불일치 거부, PEM/DER 및 손상 입력, IPC 취소/실패, UI 저장 결과와 재시작 안내도 검증합니다. CI의 Node 22.13 런타임 검사에도 CA 통합 테스트를 포함합니다.

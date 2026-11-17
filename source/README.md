# 소스 (source)

이 폴더는 "포켓로그 - 도주런 없는 엔드리스 에디션"의 소스입니다. 처음 내용은 게임 폴더의
`resources/docs/source/pokerogue-local-source-20261114.zip`을 그대로 푼 것이고, 이후 변경은 이 폴더에서 합니다.

| 폴더 | 내용 |
| --- | --- |
| `pokerogue/` | 게임 코드(TypeScript)와 번역 파일(`locales/`) |
| `offline-app/` | Electron 실행 파일 래퍼 |
| `tools/port/` | 추가 그림을 게임 폴더에 써 넣는 스크립트 |

## 게임 폴더에 반영하기

코드나 번역을 고친 뒤 아래 스크립트를 실행하면, 빌드 결과(코드 번들과 번역 파일)가 저장소의 게임 폴더
(`포켓로그 - 도주런 없는 엔드리스 에디션/resources/game`)에 설치됩니다. Node 22 이상과 pnpm이 필요합니다.

```sh
source/build-game.sh
```

그림과 소리는 게임 폴더에 이미 들어 있으므로 건드리지 않습니다. 새 아이콘은 `tools/port`의 스크립트가 게임 폴더에
직접 씁니다(예: `python -I source/tools/port/make_marks_atlas.py "<게임 폴더>/resources/game"`).

`PokeRogue Offline.exe`는 250MB라 저장소에 없습니다. 배포본의 exe를 게임 폴더에 넣으면 그대로 실행됩니다.

## 개발 서버와 테스트

```sh
cd source/pokerogue
pnpm install --frozen-lockfile --ignore-scripts
ln -s "../../포켓로그 - 도주런 없는 엔드리스 에디션/resources/game" assets   # 그림과 소리 (저장소에는 올리지 않음)
pnpm exec vite --mode development      # http://localhost:8000
pnpm exec vitest run test/tests/custom # 이 판의 테스트
```

개발 서버는 번역 파일을 `assets/locales`(게임 폴더)에서 읽습니다. 번역을 고쳤다면 `source/build-game.sh`를 먼저
실행해야 개발 서버에도 보입니다.

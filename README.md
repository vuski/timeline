# Timeline Explorer

Explore your Google Maps Timeline on a map — in your browser, offline.

**<https://timeline.vw-lab.com>**

> ## 🔒 Your data never leaves your device
>
> There is **no server**. No upload, no account, no tracking of your locations.
> The JSON file is read and drawn entirely inside your browser, and it stays on
> your machine. Verify it in the source of this repository.

## Where to get the file

The Timeline lives **on your phone**. Export it from the Google Maps app or
your phone settings — not from any web download page.

**Android** — Settings → Location → Location Services → Timeline → Export
Timeline data

**iPhone** — Google Maps app → your profile picture → Your Timeline → ⋯ →
Location & privacy settings → Export Timeline data

You get a `Timeline.json` (or `타임라인.json`). Drop it on the page.

## Features

- Date range and kind (stay / move) filters, list linked to the map
- Trim stay vertices, delete tracks by point, undo
- Stay totals per map tile
- Playback and video recording (WebM/MP4) with a caption burned in
- Screenshot and share
- English / 한국어

## Tech

React 19 · TypeScript · Vite · MapLibre GL · deck.gl

## Development

```powershell
npm install
npm run dev
```

| Command         | What it does                         |
| --------------- | ------------------------------------ |
| `npm run dev`   | Dev server (port 5173, bound to LAN) |
| `npm run build` | Type check + production build        |
| `npm test`      | Tests                                |
| `npm run lint`  | oxlint                               |

### Environment

Copy `.env.example` to `.env`. Leave it empty to skip the analytics script.

```
VITE_GA_ID=
```

The deployed value comes from the repository secret `VITE_GA_ID`.

Analytics counts button presses only — never coordinates, times, or file
contents.

## Deployment

Pushing to `main` runs type checks and tests, then publishes to GitHub Pages.
The custom domain is in `public/CNAME`.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE) — noncommercial use only.
Personal use, research, and use by educational, government, and nonprofit
organizations are permitted. **Commercial use is not.**

Copyright (c) 2026 vuski

Made by [VWL Inc.](https://www.vw-lab.com)

---

# Timeline Explorer (한국어)

구글 지도 타임라인을 지도 위에서 살펴보는 웹 앱. 브라우저 안에서만 돕니다.

**<https://timeline.vw-lab.com>**

> ## 🔒 타임라인 데이터는 기기 밖으로 나가지 않습니다
>
> **서버가 없습니다.** 업로드도, 계정도, 위치 수집도 없습니다. JSON 파일은
> 브라우저 안에서만 읽고 그리며 내 컴퓨터에 그대로 남습니다. 이 저장소의
> 소스코드로 확인할 수 있습니다.

## 파일 받는 곳

타임라인은 **휴대폰 안에** 있습니다. 구글 지도 앱이나 휴대폰 설정에서
내보내야 합니다 — 웹의 다운로드 페이지가 아닙니다.

**안드로이드** — 설정 → 위치 → 위치 서비스 → 타임라인 → 타임라인 데이터 내보내기

**아이폰** — 구글 지도 앱 → 프로필 사진 → 내 타임라인 → ⋯ → 위치 및 개인정보
보호 설정 → 타임라인 데이터 내보내기

`타임라인.json`(또는 `Timeline.json`)이 나옵니다. 이 파일을 페이지에 끌어다
놓으면 됩니다.

## 기능

- 날짜 구간 · 종류(체류/이동) 필터, 목록과 지도 연동
- 체류 정점 잘라내기, 점 기준 궤적 삭제, 되돌리기
- 타일별 체류시간 집계
- 재생과 영상 녹화(WebM/MP4), 문구 새기기
- 화면 캡쳐 · 공유
- 한국어 / English

## 기술

React 19 · TypeScript · Vite · MapLibre GL · deck.gl

## 개발

```powershell
npm install
npm run dev
```

| 명령            | 하는 일                           |
| --------------- | --------------------------------- |
| `npm run dev`   | 개발 서버 (5173 고정, LAN 바인딩) |
| `npm run build` | 타입 검사 + 프로덕션 빌드         |
| `npm test`      | 테스트                            |
| `npm run lint`  | oxlint                            |

### 환경변수

`.env.example` 을 `.env` 로 복사해서 채웁니다. 비워두면 통계 스크립트를 붙이지
않습니다.

```
VITE_GA_ID=
```

배포 값은 GitHub 저장소 Secrets 의 `VITE_GA_ID` 에서 옵니다.

통계는 버튼을 눌렀다는 사실만 셉니다 — 좌표·시각·파일 내용은 보내지 않습니다.

## 배포

`main` 에 push 하면 GitHub Actions 가 타입 검사와 테스트를 거쳐 GitHub Pages 로
올립니다. 커스텀 도메인은 `public/CNAME` 에 있습니다.

## 라이선스

[PolyForm Noncommercial License 1.0.0](LICENSE) — 비영리 목적으로만 사용할 수
있습니다. 개인적 이용, 연구, 교육기관 · 공공기관 · 비영리단체의 이용은
허용됩니다. **상업적 이용은 허용되지 않습니다.**

Copyright (c) 2026 vuski

제작 : [VWL Inc.](https://www.vw-lab.com)

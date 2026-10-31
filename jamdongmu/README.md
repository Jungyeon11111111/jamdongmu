# 잠동무

잠 안 오는 사람끼리 1:1로 이어 주는 음성 통화 앱이에요. 서로 이름과 기분을 보고, 목소리로 이야기하거나 글로 속삭이고, 같은 박자로 숨 쉬고 같은 잠 소리를 들어요. 둘 다 "나 이제 잘게"를 누르면 화면이 어두워지고, 정해둔 시간이 지나면 소리와 통화가 조용히 꺼져요.

**웹앱이라서 아이폰 사파리에서 링크만 열면 바로 쓸 수 있어요.** 앱스토어나 개발자 계정이 필요 없어요.

```
jamdongmu/
├─ server/          서버 + 웹앱 (이것만 올리면 돼요)
│  ├─ index.js      짝 맞추기, 연결 중계
│  └─ public/       웹앱 화면 (index.html, app.js, style.css)
├─ app/             (나중에) 앱스토어용 네이티브 앱 — 아래 "나중에" 참고
└─ render.yaml      서버를 Render에 한 번에 올리는 설정
```

목소리는 서버를 거치지 않고 두 휴대폰이 직접 주고받아요(WebRTC). 서버는 짝을 맞추고 연결 정보만 전달해서, 통화 내용이 서버에 남지 않아요.

---

## 인터넷에 올리기 (약 20분, 무료)

컴퓨터에 아무것도 설치하지 않아도 돼요. 브라우저만 있으면 돼요.

### 1. GitHub에 코드 올리기

1. https://github.com 에 가입하고 로그인해요.
2. 오른쪽 위 **+ → New repository** → 이름은 `jamdongmu`, **Public** 선택 → **Create repository**.
3. 새 저장소 화면에서 **uploading an existing file**을 눌러요.
4. 압축을 푼 `jamdongmu` 폴더 **안에 있는 것들**(`server`, `app`, `render.yaml`, `README.md` 등)을 끌어다 놓아요.
   - `node_modules` 폴더가 보이면 빼고 올려요.
5. 아래 **Commit changes**를 눌러요.

### 2. Render에 서버 올리기

1. https://render.com 에서 **GitHub 계정으로 가입**해요.
2. **New + → Blueprint** → `jamdongmu` 저장소를 고르고 **Connect**를 눌러요.
3. TURN 값 3개는 일단 비워 두고 **Apply**를 눌러요.
4. 5분쯤 지나면 `https://jamdongmu-server-xxxx.onrender.com` 같은 주소가 생겨요. **이게 잠동무 주소예요.**

> 무료 플랜은 15분 동안 아무도 없으면 서버가 잠들어요. 그 뒤 처음 여는 사람은 30~60초 기다려야 해요. 이건 정상이에요.

### 3. 아이폰에서 열기

1. 사파리에서 위 주소를 열어요.
2. 아래쪽 **공유 버튼(□↑) → 홈 화면에 추가**를 누르면 달 모양 아이콘이 생기고, 앱처럼 열려요.
3. "같이 잠들 사람 찾기"를 누르고, 마이크 권한을 물으면 **허용**을 눌러요.
4. 친구에게 주소를 보내서 친구도 동시에 누르면 연결돼요.

### 4. (권장) TURN 서버 설정하기

같은 와이파이끼리는 바로 잘 돼요. 하지만 **LTE/5G끼리**나 학교 와이파이에서는 연결이 막히는 경우가 많아서, 중계용 TURN 서버가 있어야 안정적이에요. "목소리 연결에 실패했어요"가 뜨면 이걸 해 주세요.

1. https://www.metered.ca/stun-turn 에서 무료 플랜에 가입해요.
2. 대시보드에서 TURN 주소, 사용자명(username), 비밀번호(credential)를 확인해요.
3. Render → `jamdongmu-server` → **Environment**에 넣고 저장해요:
   - `TURN_URLS` = `turn:주소:80,turn:주소:443,turns:주소:443` (쉼표로 구분)
   - `TURN_USERNAME` = 사용자명
   - `TURN_CREDENTIAL` = 비밀번호

---

## 아이폰에서 쓸 때 알아둘 점

- **통화 중에는 화면을 켜 두세요.** 웹앱은 화면을 잠그거나 다른 앱으로 가면 통화가 끊길 수 있어요. 그래서 통화하는 동안에는 화면이 자동으로 꺼지지 않게 해 두었어요. 둘 다 잠들면 화면이 거의 검게 바뀌어요. 충전기를 꽂아 두는 걸 추천해요.
- **소리가 작게 들리면** 이어폰을 쓰거나, 볼륨 버튼을 눌러 보세요. 아이폰은 마이크를 쓰는 동안 소리가 통화용 스피커로 나올 때가 있어요.
- **마이크를 거절했다면**: 설정 → Safari → 마이크 → 허용으로 바꿔요.

## 코드 고치기

| 바꾸고 싶은 것 | 파일 |
|---|---|
| 화면 문구, 기분 목록, 랜덤 이름 | `server/public/index.html`, `server/public/app.js` 위쪽 |
| 색, 글꼴, 크기 | `server/public/style.css` 맨 위 `:root` |
| 짝 맞추는 규칙 | `server/index.js`의 `tryMatch` |

GitHub 저장소에서 파일을 열고 연필 아이콘으로 고친 뒤 저장(Commit)하면, Render가 알아서 몇 분 안에 새 버전으로 바꿔 줘요.

내 컴퓨터에서 돌려 보려면 (Node.js 20 이상 필요):

```bash
cd server
npm install
npm start          # http://localhost:3000 에서 열려요
npm test           # 서버 자동 테스트
```

## 아직 부족한 점 (공개 출시 전에 필요한 것)

- **안전 장치**: 지금은 "차단하기"만 있고, 차단 목록은 서버가 다시 시작되면 사라져요. 모르는 사람끼리 밤에 음성으로 연결되는 서비스라서, 공개하려면 신고 기능과 신고를 처리할 관리 화면, 연령 확인, 이용약관·개인정보처리방침이 꼭 필요해요. 그 전까지는 아는 친구들끼리 써 보는 걸 추천해요.
- **화면 잠금 중 통화**: 웹앱의 한계예요. 이게 꼭 필요해지면 아래 네이티브 앱으로 넘어가면 돼요.

## 나중에: 앱스토어용 네이티브 앱 (`app/` 폴더)

화면이 꺼져도 통화가 이어지는 진짜 앱 버전이에요. 같은 서버를 쓰고, 설정과 화면도 거의 같아요. 아이폰에 설치하려면 Apple 개발자 계정(연 $99)이 필요해요.

1. `app/src/config.js`의 `SERVER_URL`을 Render 주소로 바꿔요.
2. ```bash
   cd app
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest build:configure
   npx eas-cli@latest device:create                         # 테스트할 아이폰 등록
   npx eas-cli@latest build --profile preview --platform ios
   ```
3. 친구들에게 나눠 주려면 TestFlight를 써요: `npx eas-cli@latest build --platform ios` 다음 `npx eas-cli@latest submit --platform ios`.

이 앱은 Expo Go로는 실행되지 않아요(음성 통화 모듈 때문). 실제 아이폰에서 아직 테스트하지 못했어요.

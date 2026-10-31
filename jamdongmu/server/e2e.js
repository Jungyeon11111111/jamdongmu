// 브라우저 두 개로 실제 웹앱을 열어 짝 맞추기 → 음성 연결 → 속삭임 → 끊기까지 확인
process.env.PORT = process.env.PORT || "3998";
const { server } = require("./index");
const { chromium } = require("playwright");
const url = `http://localhost:${process.env.PORT}/`;
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok -", m); };

(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
  const mk = async () => { const c = await browser.newContext({ permissions: ["microphone"], viewport: { width: 390, height: 844 } }); const p = await c.newPage(); p.on("pageerror", (e) => console.error("pageerror", e)); await p.goto(url); return p; };
  const a = await mk(), b = await mk();
  await a.waitForFunction(() => window.__jd.phase === "idle");
  await b.waitForFunction(() => window.__jd.phase === "idle");
  ok(true, "두 사람 모두 서버에 연결됨");
  await a.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + "/home.png" : "/dev/null" }).catch(() => {});

  await a.fill("#nick", "졸린 수달");
  await a.click("#find");
  await a.waitForFunction(() => window.__jd.phase === "waiting");
  await b.click("#find");
  await a.waitForFunction(() => window.__jd.phase === "live", null, { timeout: 15000 });
  await b.waitForFunction(() => window.__jd.phase === "live", null, { timeout: 15000 });
  ok(true, "음성(WebRTC) 연결 성공 — 두 화면 모두 '통화 중'");
  ok((await b.textContent("#pname")) === "졸린 수달", "상대 이름이 보인다");

  const hasAudio = await b.evaluate(() => { const s = document.getElementById("remote").srcObject; return !!s && s.getAudioTracks().length > 0; });
  ok(hasAudio, "상대 목소리 트랙을 받는다");

  await a.fill("#sayinput", "잠이 안 와요");
  await a.click("#sayform button");
  await b.waitForFunction(() => [...document.querySelectorAll(".msg")].some((m) => m.textContent === "잠이 안 와요"));
  ok(true, "속삭임이 상대에게 보인다");

  await b.click("#sounds button:nth-child(2)");
  await a.waitForFunction(() => document.querySelector("#sounds button:nth-child(2)").getAttribute("aria-pressed") === "true");
  ok(true, "한 사람이 고른 잠 소리가 상대에게도 켜진다");

  await a.click("#sleep"); await b.click("#sleep");
  await a.waitForFunction(() => !document.getElementById("night").hidden);
  ok(true, "둘 다 잠들면 화면이 어두워진다");
  if (process.env.SHOT_DIR) { await a.click("#wake"); await a.screenshot({ path: process.env.SHOT_DIR + "/call.png" }); }

  await a.click("#hangup");
  await b.waitForFunction(() => window.__jd.phase === "ended");
  ok(true, "한 사람이 끊으면 상대도 통화 종료 화면");

  await browser.close(); server.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

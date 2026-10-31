// 간단한 동작 확인: 두 사람이 짝지어지고 신호·속삭임이 오가는지, 차단 후 다시 안 만나는지
process.env.PORT = process.env.PORT || "3999";
const { server } = require("./index");
const { io } = require("socket.io-client");
const url = `http://localhost:${process.env.PORT}`;
const wait = (s, ev) => new Promise((r) => s.once(ev, r));
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok -", m); };

(async () => {
  const a = io(url, { auth: { deviceId: "A", nick: "수달", mood: "뒤척이는 중" } });
  const b = io(url, { auth: { deviceId: "B", nick: "부엉이" } });
  const helloA = await wait(a, "hello");
  assert(Array.isArray(helloA.iceServers), "hello에 ICE 서버 목록이 온다");
  await wait(b, "hello");

  a.emit("find");
  await new Promise((r) => setTimeout(r, 100));
  const mA = wait(a, "matched"), mB = wait(b, "matched");
  b.emit("find");
  const [ma, mb] = await Promise.all([mA, mB]);
  assert(ma.initiator && !mb.initiator, "먼저 기다린 사람이 initiator");
  assert(ma.partner.nick === "부엉이" && mb.partner.nick === "수달", "서로 이름을 받는다");

  const sig = wait(b, "signal");
  a.emit("signal", { description: { type: "offer", sdp: "v=0" } });
  assert((await sig).description.type === "offer", "offer가 상대에게 전달된다");

  const say = wait(a, "say");
  b.emit("say", { text: "  잠이 안 와요  " });
  assert((await say).text === "잠이 안 와요", "속삭임이 다듬어져 전달된다");

  const left = wait(b, "partner-left");
  a.emit("hangup", { block: true });
  assert((await left).reason === "blocked", "차단하면 상대에게 통화 종료가 간다");

  a.emit("find"); b.emit("find");
  let rematched = false;
  a.once("matched", () => (rematched = true));
  await new Promise((r) => setTimeout(r, 300));
  assert(!rematched, "차단한 사람과는 다시 짝지어지지 않는다");

  const c = io(url, { auth: { deviceId: "C", nick: "해파리" } });
  const mc = wait(c, "matched");
  c.emit("find");
  assert((await mc).partner.nick === "수달", "새로 온 사람은 기다리던 사람과 연결된다");

  a.close(); b.close(); c.close(); server.close(); process.exit(0);
})();

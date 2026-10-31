// 잠동무 시그널링 서버
// - 잠 안 오는 사람들을 1:1로 짝지어 주고
// - WebRTC 연결 정보(offer/answer/ICE)와 속삭임·토닥·소리·잠듦 상태를 상대에게 전달합니다.
// 목소리 자체는 서버를 거치지 않고 두 휴대폰이 직접(또는 TURN 서버를 통해) 주고받습니다.

const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

// ICE 서버: STUN은 무료 공개 서버, TURN은 환경변수로 설정 (README 참고)
function iceServers() {
  const list = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_URLS) {
    list.push({
      urls: process.env.TURN_URLS.split(",").map((s) => s.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || "",
    });
  }
  return list;
}

const app = express();
// 웹앱 화면 (public 폴더)
app.use(express.static(require("path").join(__dirname, "public"), { maxAge: "1h" }));
app.get("/health", (_req, res) => res.json({ ok: true, awake: io.engine.clientsCount, waiting: queue.length }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" }, pingInterval: 20000, pingTimeout: 25000 });

const queue = [];                 // 짝을 기다리는 socket 목록 (먼저 온 순서)
const blocked = new Map();        // deviceId -> Set(deviceId) : 서로 다시 연결하지 않을 사이
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n);
const SOUNDS = new Set(["off", "rain", "wave", "fan", "fire", "cricket", "train", "cafe"]);
const MODES = new Set(["chat", "quiet"]);   // 수다 떨고 싶어요 / 말없이 같이 잠들어요

// "또 만나기": 서로 좋다고 누른 두 사람만 아는 비밀 열쇠(friend key).
// 열쇠는 각자의 휴대폰에만 저장되고, 서버는 지금 접속한 사람들의 열쇠만 잠깐 기억해요.
// (서버가 다시 시작돼도 휴대폰에 열쇠가 남아 있어서 친구 관계가 사라지지 않아요.)
const keyIndex = new Map();       // key -> Set(socket.id)
const cleanKeys = (arr) => Array.isArray(arr) ? [...new Set(arr.map((k) => clean(k, 40)).filter((k) => /^[a-z0-9]{16,40}$/.test(k)))].slice(0, 50) : [];
function setKeys(socket, keys) {
  const before = socket.data.friends || new Set();
  before.forEach((k) => { const s = keyIndex.get(k); if (s) { s.delete(socket.id); if (!s.size) keyIndex.delete(k); } });
  socket.data.friends = new Set(keys);
  socket.data.friends.forEach((k) => { if (!keyIndex.has(k)) keyIndex.set(k, new Set()); keyIndex.get(k).add(socket.id); });
  notifyFriends(new Set([...before, ...socket.data.friends]));
}
function onlineKeysFor(socket) {
  return [...(socket.data.friends || [])].filter((k) => [...(keyIndex.get(k) || [])].some((id) => id !== socket.id));
}
function notifyFriends(keys) {
  const ids = new Set();
  keys.forEach((k) => (keyIndex.get(k) || []).forEach((id) => ids.add(id)));
  ids.forEach((id) => { const s = io.sockets.sockets.get(id); s?.emit("friends-online", { keys: onlineKeysFor(s) }); });
}
function sharedKey(a, b) {
  for (const k of a.data.friends || []) if (b.data.friends?.has(k)) return k;
  return null;
}

function stats() {
  return { awake: io.engine.clientsCount, waiting: queue.length };
}
let statsTimer = null;
function broadcastStats() {
  if (statsTimer) return;
  statsTimer = setTimeout(() => { statsTimer = null; io.emit("stats", stats()); }, 300);
}

function removeFromQueue(socket) {
  const i = queue.indexOf(socket);
  if (i >= 0) queue.splice(i, 1);
}
function isBlocked(a, b) {
  return blocked.get(a.data.deviceId)?.has(b.data.deviceId) || blocked.get(b.data.deviceId)?.has(a.data.deviceId);
}
function partnerOf(socket) {
  const id = socket.data.partnerId;
  return id ? io.sockets.sockets.get(id) : null;
}
function profile(s) {
  return { nick: s.data.nick, mood: s.data.mood };
}

function pair(a, b) {
  a.data.partnerId = b.id;
  b.data.partnerId = a.id;
  const callId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const friendKey = sharedKey(a, b);
  const mode = a.data.mode === b.data.mode ? a.data.mode : "chat";
  for (const [s, o] of [[a, b], [b, a]]) {
    s.data.lastCallId = callId; s.data.lastPartnerId = o.id; s.data.likedCall = null;
  }
  // 먼저 기다린 사람이 offer를 만듭니다 (initiator)
  a.emit("matched", { callId, mode, friendKey, partner: profile(b), initiator: true });
  b.emit("matched", { callId, mode, friendKey, partner: profile(a), initiator: false });
}

function canPair(a, b) {
  return a !== b && a.data.deviceId !== b.data.deviceId && !isBlocked(a, b);
}
function tryMatch(socket) {
  // 1순위: 또 만나기로 한 동무가 기다리고 있으면 모드와 상관없이 먼저 이어 줘요
  let i = queue.findIndex((o) => canPair(socket, o) && sharedKey(socket, o));
  // 2순위: 같은 모드(수다 / 말없이)를 고른 사람 중 가장 오래 기다린 사람
  if (i < 0) i = queue.findIndex((o) => canPair(socket, o) && o.data.mode === socket.data.mode);
  if (i < 0) return false;
  const [other] = queue.splice(i, 1);
  pair(other, socket);
  return true;
}

function endCall(socket, reason) {
  const p = partnerOf(socket);
  socket.data.partnerId = null;
  if (p) {
    p.data.partnerId = null;
    p.emit("partner-left", { reason });
  }
}

io.on("connection", (socket) => {
  const auth = socket.handshake.auth || {};
  socket.data.deviceId = clean(auth.deviceId, 64) || socket.id;
  socket.data.nick = clean(auth.nick, 12) || "이름 없는 별";
  socket.data.mood = clean(auth.mood, 20);
  socket.data.partnerId = null;
  socket.data.mode = "chat";

  socket.emit("hello", { iceServers: iceServers(), ...stats() });
  setKeys(socket, cleanKeys(auth.friends));
  broadcastStats();

  socket.on("friends", (m = {}) => setKeys(socket, cleanKeys(m.keys)));

  socket.on("profile", (p = {}) => {
    socket.data.nick = clean(p.nick, 12) || socket.data.nick;
    socket.data.mood = clean(p.mood, 20);
  });

  socket.on("find", (m = {}) => {
    if (socket.data.partnerId) return;
    socket.data.mode = MODES.has(m.mode) ? m.mode : "chat";
    removeFromQueue(socket);
    if (!tryMatch(socket)) queue.push(socket);
    broadcastStats();
  });

  socket.on("cancel", () => { removeFromQueue(socket); broadcastStats(); });

  // WebRTC 연결 정보 중계
  socket.on("signal", (msg = {}) => {
    const p = partnerOf(socket);
    if (!p) return;
    const out = {};
    if (msg.description && typeof msg.description.sdp === "string" && ["offer", "answer"].includes(msg.description.type)) {
      out.description = { type: msg.description.type, sdp: msg.description.sdp.slice(0, 20000) };
    }
    if (msg.candidate && typeof msg.candidate === "object") out.candidate = msg.candidate;
    if (out.description || out.candidate) p.emit("signal", out);
  });

  // 통화 중 작은 신호들
  socket.on("say", (m = {}) => { const t = clean(m.text, 120); if (t) partnerOf(socket)?.emit("say", { text: t }); });
  socket.on("pat", () => partnerOf(socket)?.emit("pat"));
  socket.on("sound", (m = {}) => { if (SOUNDS.has(m.k)) partnerOf(socket)?.emit("sound", { k: m.k }); });
  socket.on("asleep", (m = {}) => partnerOf(socket)?.emit("asleep", { v: !!m.v }));

  // 또 만나고 싶어요: 통화 중이나 끝난 직후에 눌러요. 둘 다 누르면 열쇠를 나눠 줘요.
  socket.on("like", () => {
    const callId = socket.data.lastCallId;
    if (!callId) return;
    socket.data.likedCall = callId;
    const p = io.sockets.sockets.get(socket.data.lastPartnerId);
    if (!p || p.data.lastCallId !== callId) return;
    if (p.data.likedCall === callId) {
      const key = sharedKey(socket, p) || (require("crypto").randomBytes(15).toString("hex"));
      socket.emit("friended", { key, nick: p.data.nick });
      p.emit("friended", { key, nick: socket.data.nick });
    } else {
      p.emit("liked-you");
    }
  });

  socket.on("hangup", (m = {}) => {
    const p = partnerOf(socket);
    if (m.block && p) {
      const mine = blocked.get(socket.data.deviceId) || new Set();
      mine.add(p.data.deviceId);
      blocked.set(socket.data.deviceId, mine);
    }
    endCall(socket, m.block ? "blocked" : "hangup");
  });

  socket.on("disconnect", () => {
    setKeys(socket, []);
    removeFromQueue(socket);
    endCall(socket, "disconnected");
    broadcastStats();
  });
});

server.listen(PORT, () => console.log(`잠동무 서버: http://localhost:${PORT}`));
module.exports = { server, io };

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
const SOUNDS = new Set(["off", "rain", "wave", "fan"]);

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
  // 먼저 기다린 사람이 offer를 만듭니다 (initiator)
  a.emit("matched", { callId, partner: profile(b), initiator: true });
  b.emit("matched", { callId, partner: profile(a), initiator: false });
}

function tryMatch(socket) {
  for (let i = 0; i < queue.length; i++) {
    const other = queue[i];
    if (other === socket || other.data.deviceId === socket.data.deviceId) continue;
    if (isBlocked(socket, other)) continue;
    queue.splice(i, 1);
    pair(other, socket);
    return true;
  }
  return false;
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

  socket.emit("hello", { iceServers: iceServers(), ...stats() });
  broadcastStats();

  socket.on("profile", (p = {}) => {
    socket.data.nick = clean(p.nick, 12) || socket.data.nick;
    socket.data.mood = clean(p.mood, 20);
  });

  socket.on("find", () => {
    if (socket.data.partnerId) return;
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
    removeFromQueue(socket);
    endCall(socket, "disconnected");
    broadcastStats();
  });
});

server.listen(PORT, () => console.log(`잠동무 서버: http://localhost:${PORT}`));
module.exports = { server, io };

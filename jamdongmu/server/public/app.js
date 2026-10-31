// 잠동무 웹앱: 서버 연결 + WebRTC 음성 통화 + 잠 소리 + 숨쉬기
(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  // ---------- 이름 · 기분 ----------
  const ADJ = ["졸린", "뒤척이는", "포근한", "조용한", "눈 감은", "하품하는", "말랑한", "느린"];
  const NOUN = ["수달", "부엉이", "고양이", "해파리", "곰", "달팽이", "여우", "양"];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  let deviceId = store.get("jd-device");
  if (!deviceId) { deviceId = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set("jd-device", deviceId); }
  const nickEl = $("nick");
  nickEl.value = store.get("jd-nick") || `${pick(ADJ)} ${pick(NOUN)}`;
  const nick = () => (nickEl.value.trim() || "이름 없는 별").slice(0, 12);
  const MOODS = ["뒤척이는 중", "생각이 많아요", "그냥 심심해요", "내일이 걱정돼요"];
  let mood = store.get("jd-mood") || MOODS[0];

  // 오늘 밤은: 수다(chat) / 말없이(quiet)
  let mode = store.get("jd-mode") === "quiet" ? "quiet" : "chat";
  function renderModes() {
    document.querySelectorAll("#modes .mode").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === mode)));
  }
  document.querySelectorAll("#modes .mode").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; store.set("jd-mode", mode); renderModes(); }));
  renderModes();

  // 또 만나고 싶은 잠동무: 둘만 아는 열쇠를 이 휴대폰에만 저장해요
  let friends = [];
  try { friends = JSON.parse(store.get("jd-friends") || "[]").filter((f) => f && typeof f.key === "string"); } catch { friends = []; }
  let onlineKeys = new Set();
  const saveFriends = () => store.set("jd-friends", JSON.stringify(friends.slice(0, 50)));
  const friendKeys = () => friends.map((f) => f.key);
  function renderFriends() {
    $("friendbox").hidden = friends.length === 0;
    const box = $("friends"); box.innerHTML = "";
    friends.forEach((f) => {
      const on = onlineKeys.has(f.key);
      const el = document.createElement("div"); el.className = "friend" + (on ? " on" : "");
      const dot = document.createElement("span"); dot.className = "dot";
      const name = document.createElement("span"); name.textContent = f.nick + (on ? " · 깨어 있어요" : "");
      const x = document.createElement("button"); x.className = "x"; x.type = "button"; x.textContent = "×"; x.setAttribute("aria-label", f.nick + " 지우기");
      x.onclick = () => { friends = friends.filter((g) => g.key !== f.key); saveFriends(); socket.emit("friends", { keys: friendKeys() }); renderFriends(); };
      el.append(dot, name, x); box.appendChild(el);
    });
    renderHome();
  }

  function chipRow(el, items, isOn, onPick) {
    el.innerHTML = "";
    items.forEach(([key, label]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "ghost"; b.textContent = label;
      b.setAttribute("aria-pressed", isOn(key));
      b.onclick = () => onPick(key);
      el.appendChild(b);
    });
  }
  function renderMoods() {
    chipRow($("moods"), MOODS.map((m) => [m, m]), (k) => k === mood, (k) => {
      mood = k; store.set("jd-mood", k); renderMoods(); sendProfile();
    });
  }
  renderMoods();
  nickEl.addEventListener("input", () => { store.set("jd-nick", nickEl.value); sendProfile(); });

  // ---------- 시계 ----------
  const fmt = (d) => d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
  function tickClock() {
    const d = new Date(); $("clock").textContent = fmt(d);
    const h = d.getHours();
    $("greet").textContent = h < 5 ? "새벽인데 아직 깨어 있나요?" : h >= 21 ? "오늘 밤, 잠이 안 오나요?" : "잠이 안 오는 시간인가요?";
  }
  tickClock(); setInterval(tickClock, 15000);

  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (isIOS && !standalone) $("installtip").hidden = false;

  // ---------- 화면 전환 ----------
  let phase = "connecting";
  const SCREENS = { idle: "home", connecting: "home", offline: "home", waiting: "wait", calling: "call", live: "call", ended: "ended" };
  function setPhase(p) {
    phase = p;
    Object.values(SCREENS).forEach((s) => { $("s-" + s).hidden = s !== SCREENS[p]; });
    $("find").disabled = p !== "idle";
    if (p === "calling" || p === "live" || p === "waiting") wakeLock(); else releaseLock();
    if (p !== "calling" && p !== "live") $("night").hidden = true;
    renderHome();
  }

  // ---------- 잠 소리 (파일 없이 브라우저에서 만들어요) ----------
  let ac = null, master = null, nodes = [], sound = "off";
  const BASE_VOL = 0.45;
  function ensureAudio() {
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
      } catch { ac = null; }
    }
    if (ac && ac.state !== "running") ac.resume().catch(() => {});
    return ac;
  }
  const bufs = {};
  function noise(type) {
    if (bufs[type]) return bufs[type];
    const len = ac.sampleRate * 4, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else {
        b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
        b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
      }
    }
    return (bufs[type] = buf);
  }
  function src(type) { const s = ac.createBufferSource(); s.buffer = noise(type); s.loop = true; s.start(); return s; }
  // 패턴이 있는 소리는 한 번 만들어 둔 조각을 반복 재생해요
  function made(name, seconds, fill) {
    if (bufs[name]) return bufs[name];
    const sr = ac.sampleRate, len = Math.floor(sr * seconds), buf = ac.createBuffer(1, len, sr);
    fill(buf.getChannelData(0), sr, len);
    // 끝과 처음을 부드럽게 이어 붙여요
    const d = buf.getChannelData(0), f = Math.floor(sr * 0.25);
    for (let i = 0; i < f; i++) { const t = i / f; d[i] = d[i] * t + d[len - f + i] * (1 - t); }
    return (bufs[name] = buf);
  }
  function loop(buf) { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.loopEnd = buf.duration - 0.25; s.start(); return s; }
  function brownInto(d, len, amt) { let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] += last * 3.5 * amt; } }
  const BUILDERS = {
    fire: (d, sr, len) => {
      brownInto(d, len, 0.5);
      for (let n = 0; n < 90; n++) {           // 타닥타닥
        const at = Math.floor(Math.random() * (len - sr * 0.05)), amp = 0.2 + Math.random() * 0.6, dec = sr * (0.002 + Math.random() * 0.008);
        for (let i = 0; i < sr * 0.04; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / dec);
      }
    },
    cricket: (d, sr, len) => {
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.015;   // 밤 공기
      const period = sr * 1.2;
      for (let start = sr * 0.1; start < len - sr * 0.5; start += period) {  // 찌르르 찌르르
        for (const off of [0, 0.3]) {
          const s0 = Math.floor(start + off * sr);
          for (let i = 0; i < sr * 0.18; i++) {
            const t = i / sr, gate = Math.sin(2 * Math.PI * 28 * t) > 0 ? 1 : 0;
            d[s0 + i] += Math.sin(2 * Math.PI * 4300 * t) * 0.12 * gate * Math.sin(Math.PI * i / (sr * 0.18));
          }
        }
      }
    },
    train: (d, sr, len) => {
      brownInto(d, len, 0.7);
      const period = sr * 1.0;
      for (let start = 0; start < len - sr * 0.4; start += period) {   // 덜컹-덜컹
        for (const off of [0, 0.16]) {
          const s0 = Math.floor(start + off * sr);
          for (let i = 0; i < sr * 0.25; i++) {
            const t = i / sr, env = Math.exp(-t * 22);
            d[s0 + i] += (Math.sin(2 * Math.PI * 62 * t) * 0.5 + (Math.random() * 2 - 1) * 0.12) * env;
          }
        }
      }
    },
    cafe: (d, sr, len) => {
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {         // 웅성웅성
        const w = Math.random() * 2 - 1; b0 = .99 * b0 + w * .05; b1 = .96 * b1 + w * .1; b2 = .8 * b2 + w * .2;
        const t = i / sr, swell = 0.6 + 0.25 * Math.sin(2 * Math.PI * t / 2.3) + 0.15 * Math.sin(2 * Math.PI * t / 0.7);
        d[i] = (b0 + b1 + b2) * 0.35 * swell;
      }
      for (let n = 0; n < 5; n++) {           // 잔 부딪히는 소리
        const s0 = Math.floor(Math.random() * (len - sr)), f = 2400 + Math.random() * 1600;
        for (let i = 0; i < sr * 0.5; i++) { const t = i / sr; d[s0 + i] += Math.sin(2 * Math.PI * f * t) * 0.08 * Math.exp(-t * 12); }
      }
    },
  };
  const LEN = { fire: 8, cricket: 6, train: 6, cafe: 9 };
  function patterned(name, f1, f2) {
    const s = loop(made(name, LEN[name], BUILDERS[name]));
    let node = s;
    if (f1) node = node.connect(filt("highpass", f1));
    if (f2) node = node.connect(filt("lowpass", f2));
    node.connect(master); return [s];
  }
  function filt(type, f) { const x = ac.createBiquadFilter(); x.type = type; x.frequency.value = f; return x; }
  const SOUNDS = {
    off: { label: "조용히" },
    rain: { label: "빗소리", build() { const s = src("pink"); s.connect(filt("highpass", 900)).connect(filt("lowpass", 7000)).connect(master); return [s]; } },
    wave: { label: "파도", build() {
      const s = src("brown"), g = ac.createGain(); g.gain.value = .5;
      const lfo = ac.createOscillator(); lfo.frequency.value = .09; const lg = ac.createGain(); lg.gain.value = .45;
      lfo.connect(lg).connect(g.gain); lfo.start();
      s.connect(filt("lowpass", 1200)).connect(g).connect(master); return [s, lfo];
    } },
    fan: { label: "선풍기", build() { const s = src("brown"), g = ac.createGain(); g.gain.value = .8; s.connect(filt("lowpass", 500)).connect(g).connect(master); return [s]; } },
    fire: { label: "모닥불", build() { return patterned("fire", 0, 5000); } },
    cricket: { label: "귀뚜라미", build() { return patterned("cricket", 300, 0); } },
    train: { label: "기차 안", build() { return patterned("train", 0, 1800); } },
    cafe: { label: "카페", build() { return patterned("cafe", 150, 3500); } },
  };
  function playSound(k) {
    if (!SOUNDS[k]) return;
    sound = k; renderSounds();
    if (!ensureAudio()) return;
    const old = nodes; nodes = [];
    master.gain.cancelScheduledValues(ac.currentTime);
    master.gain.setTargetAtTime(0, ac.currentTime, 0.3);
    setTimeout(() => {
      old.forEach((n) => { try { n.stop(); } catch {} });
      if (sound === k && k !== "off") { nodes = SOUNDS[k].build(); master.gain.setTargetAtTime(BASE_VOL, ac.currentTime, 0.8); }
    }, 700);
  }
  function renderSounds() {
    chipRow($("sounds"), Object.entries(SOUNDS).map(([k, v]) => [k, v.label]), (k) => k === sound, (k) => {
      playSound(k); socket.emit("sound", { k });
    });
  }
  renderSounds();

  // ---------- 4-7-8 호흡 (두 휴대폰이 같은 시계를 봐요) ----------
  const CYCLE = 19000;
  function tickBreath() {
    if ($("s-call").hidden) return;
    const t = Date.now() % CYCLE; let cue, scale, left;
    if (t < 4000) { cue = "들이쉬고"; scale = 1 + .35 * (t / 4000); left = 4 - Math.floor(t / 1000); }
    else if (t < 11000) { cue = "잠깐 멈추고"; scale = 1.35; left = 7 - Math.floor((t - 4000) / 1000); }
    else { cue = "천천히 내쉬고"; scale = 1.35 - .35 * ((t - 11000) / 8000); left = 8 - Math.floor((t - 11000) / 1000); }
    $("orb").style.transform = `scale(${scale.toFixed(3)})`;
    $("cue").textContent = cue; $("bcount").textContent = left;
  }
  setInterval(tickBreath, 250);

  // ---------- 화면 켜짐 유지 ----------
  let lock = null;
  async function wakeLock() { try { if ("wakeLock" in navigator && !lock) { lock = await navigator.wakeLock.request("screen"); lock.addEventListener("release", () => (lock = null)); } } catch {} }
  function releaseLock() { try { lock?.release(); } catch {} lock = null; }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ["waiting", "calling", "live"].includes(phase)) wakeLock(); });

  // ---------- 처음 화면 ----------
  let stats = { awake: 0, waiting: 0 };
  function renderHome() {
    const others = Math.max(0, stats.awake - 1);
    $("awake").textContent =
      phase === "connecting" ? "밤하늘에 연결하는 중…" :
      phase === "offline" ? "서버에 연결할 수 없어요. 인터넷을 확인하거나 잠시 뒤 다시 열어 주세요." :
      others === 0 ? "지금은 당신만 깨어 있어요. 기다리면 누군가 올지도 몰라요." :
      `지금 ${others}명이 깨어 있어요` + (stats.waiting ? ` · ${stats.waiting}명이 기다리는 중` : "");
    const onFriends = friends.filter((f) => onlineKeys.has(f.key));
    if (phase === "idle" && onFriends.length) $("awake").textContent += ` · ${onFriends[0].nick}님도 깨어 있어요. 찾기를 누르면 먼저 이어 드려요.`;
    $("waitinfo").textContent = others ? `깨어 있는 사람 ${others}명 · 누군가 찾으면 바로 연결돼요.` : "같은 밤을 보내는 누군가가 들어오면 바로 연결돼요.";
    const sky = $("sky"), n = Math.min(others, 30) + 1;
    if (sky.querySelectorAll(".star").length !== n) {
      sky.querySelectorAll(".star").forEach((s) => s.remove());
      for (let i = 0; i < n; i++) {
        const s = document.createElement("div"); s.className = "star" + (i === 0 ? " me" : "");
        const r1 = ((Math.sin(i * 12.9898 + 1) * 43758.5453) % 1 + 1) % 1, r2 = ((Math.sin(i * 78.233 + 2) * 12345.678) % 1 + 1) % 1;
        s.style.left = 4 + r1 * 88 + "%"; s.style.top = 6 + r2 * 75 + "%"; s.style.animationDelay = (r1 * 3).toFixed(2) + "s";
        sky.appendChild(s);
      }
    }
  }
  // 몽글이 자리
  const hNow = new Date().getHours();
  $("home-mongle").innerHTML = mongle(hNow < 5 ? "sleepy" : "awake");
  $("wait-mongle").innerHTML = mongle("sleepy");
  $("orb").innerHTML = mongle("awake");
  $("night-mongle").innerHTML = mongle("asleep");

  // ---------- 통화 화면 요소 ----------
  function addLog(text, who) {
    const d = document.createElement("div"); d.className = "msg" + (who === "me" ? " mine" : who === "sys" ? " sys" : "");
    d.textContent = text; $("log").appendChild(d); $("log").scrollTop = 1e6;
  }
  function patAnim(label) {
    const r = document.createElement("div"); r.className = "ripple"; $("breath").appendChild(r); setTimeout(() => r.remove(), 1700);
    const l = $("patlabel"); l.textContent = label; l.classList.add("on"); setTimeout(() => l.classList.remove("on"), 1800);
    try { navigator.vibrate?.([30, 80, 30]); } catch {}
  }
  // 또 만나고 싶어요
  let liked = false, likedByThem = false, callFriendKey = null, partnerNick = "";
  function renderLike() {
    const already = !!callFriendKey && friends.some((f) => f.key === callFriendKey);
    ["like", "like2"].forEach((id) => {
      const b = $(id);
      b.hidden = already;
      b.setAttribute("aria-pressed", String(liked));
      b.textContent = liked ? "또 만나고 싶어요 ♥" : "또 만나고 싶어요 ♡";
    });
    $("endlike").textContent = already ? `${partnerNick}님은 이제 서로의 잠동무예요. 다음에 둘 다 깨어 있으면 먼저 이어 드려요.`
      : liked && likedByThem ? "" : liked ? "상대도 누르면 다음에 먼저 이어 드려요."
      : likedByThem ? `${partnerNick}님이 또 만나고 싶어 해요.` : "";
    $("end-mongle").innerHTML = mongle(already || likedByThem ? "happy" : "awake");
  }
  function doLike() { if (liked) return; liked = true; socket.emit("like"); renderLike(); }
  $("like").onclick = doLike; $("like2").onclick = doLike;

  let startedAt = 0;
  function renderStatus() {
    const p = $("pstatus");
    if (phase === "live") {
      p.classList.add("live");
      const label = p.dataset.mode === "quiet" ? "말없이 함께" : "통화 중";
      p.textContent = `${label} · ${Math.floor((Date.now() - startedAt) / 60000)}분`;
    }
    else { p.classList.remove("live"); p.textContent = "목소리 잇는 중…"; }
  }
  setInterval(() => { if (phase === "live") renderStatus(); }, 20000);

  // 잠든 뒤 타이머
  const TIMERS = [[15, "15분"], [30, "30분"], [60, "1시간"], [0, "계속"]];
  let timerMin = +(store.get("jd-timer") ?? 30);
  if (!TIMERS.some(([m]) => m === timerMin)) timerMin = 30;
  function renderTimers() { chipRow($("timers"), TIMERS, (m) => m === timerMin, (m) => { timerMin = m; store.set("jd-timer", m); renderTimers(); armTimer(); }); }
  renderTimers();
  let asleep = false, partnerAsleep = false, timerHandle = null, fadeHandle = null;
  function armTimer() {
    clearTimeout(timerHandle); clearInterval(fadeHandle);
    if (!asleep || !timerMin) return;
    timerHandle = setTimeout(() => {
      if (ac && master) master.gain.setTargetAtTime(0, ac.currentTime, 8);
      fadeHandle = setTimeout(() => { playSound("off"); hangup(false, "timer"); }, 30000);
    }, Math.max(0, timerMin * 60000 - 30000));
  }
  function renderNight() {
    const both = asleep && partnerAsleep && (phase === "live" || phase === "calling");
    if (both && $("night").hidden) $("nightt").textContent = `${fmt(new Date())}에 함께 잠들었어요`;
    $("night").hidden = !both;
  }
  function setAsleep(v) {
    asleep = v;
    $("sleep").textContent = v ? "아직 깨어 있어요" : "나 이제 잘게";
    socket.emit("asleep", { v });
    if (v) addLog(timerMin ? `잘 자요. ${timerMin}분 뒤에 소리와 통화가 조용히 꺼져요.` : "잘 자요. 통화는 계속 이어져요.", "sys");
    $("orb").innerHTML = mongle(v ? "sleepy" : "awake");
    armTimer(); renderNight();
  }

  // ---------- WebRTC ----------
  let pc = null, localStream = null, iceServers = [], pending = [];
  const remoteAudio = $("remote");

  function cleanupPeer() {
    try { pc?.close(); } catch {}
    pc = null;
    localStream?.getTracks().forEach((t) => t.stop());
    localStream = null; pending = [];
    remoteAudio.srcObject = null;
    $("mute").setAttribute("aria-pressed", "false"); $("mute").textContent = "마이크 끄기";
  }

  async function startPeer(initiator) {
    const me = new RTCPeerConnection({ iceServers });
    pc = me;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (pc !== me) { stream.getTracks().forEach((t) => t.stop()); return; }
    localStream = stream;
    stream.getTracks().forEach((t) => me.addTrack(t, stream));
    me.onicecandidate = (e) => { if (e.candidate) socket.emit("signal", { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    me.ontrack = (e) => {
      remoteAudio.srcObject = e.streams[0] || new MediaStream([e.track]);
      remoteAudio.play().catch(() => addLog("상대 목소리가 안 들리면 화면을 한 번 눌러 주세요.", "sys"));
    };
    me.onconnectionstatechange = () => {
      if (pc !== me) return;
      const s = me.connectionState;
      if (s === "connected" && phase !== "live") {
        startedAt = Date.now(); setPhase("live"); renderStatus();
        addLog("목소리가 연결됐어요. 작게 인사해 봐요.", "sys");
      }
      if (s === "failed") { socket.emit("hangup", {}); end("failed"); }
    };
    if (initiator) {
      const offer = await me.createOffer({ offerToReceiveAudio: true });
      await me.setLocalDescription(offer);
      socket.emit("signal", { description: { type: me.localDescription.type, sdp: me.localDescription.sdp } });
    }
  }

  async function handleSignal({ description, candidate }) {
    // 마이크 허락을 기다리는 동안 먼저 도착한 신호는 잠깐 미뤄 둬요
    if (!pc || (!localStream && description)) { pending.push({ description, candidate }); return; }
    try {
      if (description) {
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("signal", { description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
        }
        const later = pending; pending = [];
        for (const m of later) await handleSignal(m);
      } else if (candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(candidate);
        else pending.push({ candidate });
      }
    } catch (e) { console.warn("signal error", e); }
  }

  // ---------- 통화 끝 ----------
  const END_TEXT = {
    "partner-left": "상대가 통화를 끝냈어요.",
    "partner-gone": "상대의 연결이 끊어졌어요.",
    "you-left": "통화를 끝냈어요.",
    "you-blocked": "차단하고 끝냈어요. 이 사람과는 다시 연결되지 않아요.",
    network: "인터넷 연결이 끊어졌어요.",
    failed: "목소리 연결에 실패했어요. 네트워크가 막혀 있을 수 있어요.",
    mic: "마이크를 쓸 수 없어요. 아이폰 설정 → Safari → 마이크에서 허용해 주세요.",
    timer: "잠든 뒤 정해둔 시간이 지나 통화를 끝냈어요. 좋은 아침이에요.",
  };
  function end(reason) {
    cleanupPeer();
    clearTimeout(timerHandle); clearTimeout(fadeHandle);
    asleep = false; partnerAsleep = false; $("sleep").textContent = "나 이제 잘게";
    $("endtext").textContent = END_TEXT[reason] || "통화가 끝났어요.";
    setPhase("ended");
  }
  function hangup(block, reason) {
    socket.emit("hangup", { block: !!block });
    end(reason || (block ? "you-blocked" : "you-left"));
  }

  // ---------- 서버 연결 ----------
  const socket = io({ transports: ["websocket"], auth: { deviceId, nick: nick(), mood, friends: friendKeys() } });
  function sendProfile() { socket.emit("profile", { nick: nick(), mood }); }

  socket.on("connect", () => { if (phase === "connecting" || phase === "offline") setPhase("idle"); sendProfile(); socket.emit("friends", { keys: friendKeys() }); });
  socket.on("connect_error", () => { if (phase === "connecting") setPhase("offline"); });
  socket.on("disconnect", () => {
    if (phase === "calling" || phase === "live") end("network");
    else setPhase("offline");
  });
  socket.on("hello", (h) => { iceServers = h.iceServers || []; stats = { awake: h.awake, waiting: h.waiting }; renderHome(); });
  socket.on("stats", (s) => { stats = s; renderHome(); });
  socket.on("matched", async ({ partner, initiator, mode: callMode, friendKey }) => {
    partnerNick = partner?.nick || "이름 없는 별";
    callFriendKey = friendKey && friends.some((f) => f.key === friendKey) ? friendKey : null;
    liked = false; likedByThem = false; renderLike();
    $("pname").textContent = partnerNick;
    $("pmood").textContent = partner?.mood || "";
    $("log").innerHTML = ""; asleep = false; partnerAsleep = false;
    $("sleep").textContent = "나 이제 잘게";
    resetBlock();
    setPhase("calling"); renderStatus(); tickBreath();
    if (callFriendKey) addLog(`또 만났어요! ${partnerNick}님은 당신의 잠동무예요.`, "sys");
    if (callMode === "quiet") {
      addLog("말없이 같이 잠드는 밤이에요. 말하지 않아도 괜찮아요. 숨소리만 나눠요.", "sys");
      $("sayinput").placeholder = "꼭 하고 싶은 말만 작게 적어요";
    } else $("sayinput").placeholder = "말하기 어려우면 글로 속삭여요";
    $("pstatus").dataset.mode = callMode || "chat";
    try { await startPeer(initiator); const later = pending; pending = []; for (const m of later) await handleSignal(m); }
    catch (e) { console.warn(e); socket.emit("hangup", {}); end("mic"); }
  });
  socket.on("signal", handleSignal);
  socket.on("say", (m) => addLog(m.text, "them"));
  socket.on("pat", () => patAnim("상대가 토닥였어요"));
  socket.on("sound", (m) => playSound(m.k));
  socket.on("asleep", (m) => { partnerAsleep = !!m.v; if (partnerAsleep) addLog("상대가 잠들었어요.", "sys"); renderNight(); });
  socket.on("liked-you", () => { likedByThem = true; if (phase === "live" || phase === "calling") addLog(`${partnerNick}님이 또 만나고 싶어 해요 ♡`, "sys"); renderLike(); });
  socket.on("friended", ({ key, nick: fnick }) => {
    if (typeof key !== "string") return;
    callFriendKey = key;
    if (!friends.some((f) => f.key === key)) { friends.unshift({ key, nick: String(fnick || partnerNick).slice(0, 12), since: Date.now() }); saveFriends(); }
    socket.emit("friends", { keys: friendKeys() });
    if (phase === "live" || phase === "calling") { addLog(`이제 ${partnerNick}님과 서로의 잠동무예요. 다음에 둘 다 깨어 있으면 먼저 이어 드려요.`, "sys"); patAnim("♥ 잠동무가 됐어요"); }
    renderLike(); renderFriends();
  });
  socket.on("friends-online", ({ keys }) => { onlineKeys = new Set(Array.isArray(keys) ? keys : []); renderFriends(); });
  socket.on("partner-left", ({ reason }) => end(reason === "disconnected" ? "partner-gone" : "partner-left"));

  // ---------- 버튼 ----------
  function unlockAudio() {
    // 아이폰은 사용자가 누른 순간에만 소리를 켤 수 있어서, 찾기 버튼을 누를 때 미리 깨워 둬요
    ensureAudio();
    remoteAudio.play().catch(() => {});
  }
  function startFind() {
    unlockAudio(); socket.emit("find", { mode }); setPhase("waiting");
    $("waittitle").innerHTML = mode === "quiet" ? "말없이 같이 잠들<br>사람을 기다리는 중" : "잠 못 드는 사람을<br>기다리는 중";
  }
  $("find").onclick = startFind;
  $("cancel").onclick = () => { socket.emit("cancel"); setPhase("idle"); };
  $("again").onclick = startFind;
  $("home").onclick = () => { playSound("off"); setPhase("idle"); };
  $("hangup").onclick = () => hangup(false);
  $("sleep").onclick = () => setAsleep(!asleep);
  $("wake").onclick = () => setAsleep(false);
  $("pat").onclick = () => { socket.emit("pat"); patAnim("토닥토닥 보냈어요"); };
  $("mute").onclick = () => {
    const t = localStream?.getAudioTracks()[0]; if (!t) return;
    t.enabled = !t.enabled;
    $("mute").setAttribute("aria-pressed", String(!t.enabled));
    $("mute").textContent = t.enabled ? "마이크 끄기" : "마이크 꺼짐";
  };
  $("sayform").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = $("sayinput").value.trim(); if (!t) return;
    socket.emit("say", { text: t }); addLog(t, "me"); $("sayinput").value = "";
  });
  function resetBlock() {
    const box = $("blockbox"); box.innerHTML = "";
    const b = document.createElement("button"); b.className = "linkish"; b.textContent = "불편한 상대인가요? 차단하기";
    b.onclick = () => {
      box.innerHTML = "";
      const q = document.createElement("span"); q.textContent = "이 사람과 다시 연결되지 않게 할까요? ";
      const yes = document.createElement("button"); yes.className = "linkish"; yes.style.color = "var(--lamp)"; yes.textContent = "차단하고 끝내기";
      yes.onclick = () => hangup(true);
      const no = document.createElement("button"); no.className = "linkish"; no.textContent = "취소"; no.onclick = resetBlock;
      box.append(q, yes, no);
    };
    box.appendChild(b);
  }
  resetBlock();
  renderFriends(); renderLike();
  document.addEventListener("click", () => { if (remoteAudio.srcObject && remoteAudio.paused) remoteAudio.play().catch(() => {}); });

  setPhase("connecting");
  window.__jd = { get phase() { return phase; }, get pc() { return pc; }, get friends() { return friends; } };
})();

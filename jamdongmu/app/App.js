import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, Vibration, View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCall } from "./src/useCall";

const C = {
  ink: "#0d1220", ink2: "#151c30", line: "#26304a",
  paper: "#e8e2d2", dim: "#9aa1b6", lamp: "#e9b872", lampSoft: "rgba(233,184,114,0.16)",
  moss: "#8fb8a3", night: "#05070d",
};
const SERIF = Platform.select({ ios: "AppleMyungjo", android: "serif" });

const ADJ = ["졸린", "뒤척이는", "포근한", "조용한", "눈 감은", "하품하는", "말랑한", "느린"];
const NOUN = ["수달", "부엉이", "고양이", "해파리", "곰", "달팽이", "여우", "양"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const MOODS = ["뒤척이는 중", "생각이 많아요", "그냥 심심해요", "내일이 걱정돼요"];
const SOUND_LABELS = { off: "조용히", rain: "빗소리", wave: "파도", fan: "선풍기" };
const TIMERS = [{ m: 15, l: "15분" }, { m: 30, l: "30분" }, { m: 60, l: "1시간" }, { m: 0, l: "계속" }];
const END_TEXT = {
  "partner-left": "상대가 통화를 끝냈어요.",
  "partner-gone": "상대의 연결이 끊어졌어요.",
  "you-left": "통화를 끝냈어요.",
  "you-blocked": "차단하고 끝냈어요. 이 사람과는 다시 연결되지 않아요.",
  network: "인터넷 연결이 끊어졌어요.",
  failed: "목소리 연결에 실패했어요. 네트워크가 막혀 있을 수 있어요.",
  mic: "마이크를 쓸 수 없어요. 설정에서 마이크 권한을 허락해 주세요.",
  timer: "잠든 뒤 정해둔 시간이 지나 통화를 끝냈어요. 좋은 아침이에요.",
};

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [deviceId, setDeviceId] = useState(null);
  const [nick, setNick] = useState("");
  const [mood, setMood] = useState(MOODS[0]);
  const [log, setLog] = useState([]);
  const [sound, setSound] = useState("off");
  const [asleep, setAsleep] = useState(false);
  const [partnerAsleep, setPartnerAsleep] = useState(false);
  const [timerMin, setTimerMin] = useState(30);
  const [patFlash, setPatFlash] = useState(null);
  const [startedAt, setStartedAt] = useState(null);

  // 처음 실행: 기기 id와 이름 불러오기
  useEffect(() => {
    (async () => {
      let id = await AsyncStorage.getItem("deviceId").catch(() => null);
      if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); AsyncStorage.setItem("deviceId", id).catch(() => {}); }
      const savedNick = await AsyncStorage.getItem("nick").catch(() => null);
      const savedMood = await AsyncStorage.getItem("mood").catch(() => null);
      setNick(savedNick || `${pick(ADJ)} ${pick(NOUN)}`);
      if (savedMood) setMood(savedMood);
      setDeviceId(id);
    })();
    // 통화와 잠 소리가 함께 나오도록 오디오 모드 설정
    setAudioModeAsync({
      playsInSilentMode: true,
      allowsRecording: true,
      shouldPlayInBackground: true,
      interruptionMode: "mixWithOthers",
    }).catch(() => {});
  }, []);
  useEffect(() => { if (nick) AsyncStorage.setItem("nick", nick).catch(() => {}); }, [nick]);
  useEffect(() => { AsyncStorage.setItem("mood", mood).catch(() => {}); }, [mood]);

  const addLog = useCallback((text, who) => setLog((l) => [...l.slice(-60), { id: Date.now() + Math.random(), text, who }]), []);
  const flashPat = useCallback((label) => {
    setPatFlash({ label, at: Date.now() });
    Vibration.vibrate([0, 30, 80, 30]);
  }, []);

  const call = useCall({
    deviceId,
    nick: nick.trim().slice(0, 12) || "이름 없는 별",
    mood,
    onSay: (t) => addLog(t, "them"),
    onPat: () => flashPat("상대가 토닥였어요"),
    onSound: (k) => setSound(k),
    onPartnerAsleep: (v) => { setPartnerAsleep(v); if (v) addLog("상대가 잠들었어요.", "sys"); },
  });
  const { phase } = call;

  // ---------- 잠 소리 ----------
  const players = {
    rain: useAudioPlayer(require("./assets/sounds/rain.wav")),
    wave: useAudioPlayer(require("./assets/sounds/wave.wav")),
    fan: useAudioPlayer(require("./assets/sounds/fan.wav")),
  };
  const playersRef = useRef(players);
  playersRef.current = players;
  useEffect(() => {
    Object.entries(playersRef.current).forEach(([k, p]) => {
      p.loop = true;
      if (k === sound) { p.volume = 0.45; p.play(); } else p.pause();
    });
  }, [sound]);
  const chooseSound = (k) => { setSound(k); call.send("sound", { k }); };

  // ---------- 통화 단계에 따라 ----------
  const inCall = phase === "calling" || phase === "live";
  useEffect(() => {
    if (inCall || phase === "waiting") activateKeepAwakeAsync().catch(() => {});
    else deactivateKeepAwake();
  }, [inCall, phase]);
  useEffect(() => {
    if (phase === "calling") { setLog([]); setAsleep(false); setPartnerAsleep(false); }
    if (phase === "live") { setStartedAt(Date.now()); addLog("목소리가 연결됐어요. 작게 인사해 봐요.", "sys"); }
    if (phase === "ended") { setAsleep(false); setPartnerAsleep(false); }
  }, [phase, addLog]);

  // ---------- 잠든 뒤 타이머: 소리를 줄이고 통화를 끝냄 ----------
  useEffect(() => {
    if (!asleep || !timerMin || !inCall) return;
    const fadeStart = setTimeout(() => {
      let v = 0.45;
      const iv = setInterval(() => {
        v = Math.max(0, v - 0.03);
        Object.values(playersRef.current).forEach((p) => { p.volume = v; });
        if (v === 0) { clearInterval(iv); setSound("off"); call.hangup(false, "timer"); }
      }, 2000);
    }, Math.max(0, timerMin * 60000 - 30000));
    return () => clearTimeout(fadeStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asleep, timerMin, inCall]);

  const toggleAsleep = () => {
    const v = !asleep;
    setAsleep(v);
    call.send("asleep", { v });
    if (v) addLog(timerMin ? `잘 자요. ${timerMin}분 뒤에 소리와 통화가 조용히 꺼져요.` : "잘 자요. 통화는 계속 이어져요.", "sys");
  };

  const endText = END_TEXT[call.endReason] || "통화가 끝났어요.";

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom", "left", "right"]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Header />
        {(phase === "connecting" || phase === "offline" || phase === "idle") && (
          <Home phase={phase} stats={call.stats} nick={nick} setNick={setNick} mood={mood} setMood={setMood} onFind={call.find} />
        )}
        {phase === "waiting" && <Waiting stats={call.stats} onCancel={call.cancel} />}
        {inCall && (
          <CallScreen
            call={call} log={log} addLog={addLog} sound={sound} chooseSound={chooseSound}
            asleep={asleep} toggleAsleep={toggleAsleep} timerMin={timerMin} setTimerMin={setTimerMin}
            patFlash={patFlash} flashPat={flashPat} startedAt={startedAt}
          />
        )}
        {phase === "ended" && (
          <Ended text={endText} onAgain={call.find} onHome={() => { setSound("off"); call.setPhase("idle"); }} />
        )}
      </KeyboardAvoidingView>
      {inCall && asleep && partnerAsleep && <NightOverlay onWake={toggleAsleep} />}
    </SafeAreaView>
  );
}

// ---------- 화면들 ----------
function Header() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return (
    <View style={s.header}>
      <Text style={s.brand}>잠동무</Text>
      <Text style={s.clock}>{now.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}</Text>
    </View>
  );
}

function Home({ phase, stats, nick, setNick, mood, setMood, onFind }) {
  const h = new Date().getHours();
  const title = h < 5 ? "새벽인데\n아직 깨어 있나요?" : h >= 21 ? "오늘 밤,\n잠이 안 오나요?" : "잠이 안 오는\n시간인가요?";
  const others = Math.max(0, stats.awake - 1);
  const status = phase === "connecting" ? "밤하늘에 연결하는 중…"
    : phase === "offline" ? "서버에 연결할 수 없어요. 인터넷을 확인하거나 잠시 뒤 다시 열어 주세요."
    : others === 0 ? "지금은 당신만 깨어 있어요. 기다리면 누군가 올지도 몰라요."
    : `지금 ${others}명이 깨어 있어요${stats.waiting ? ` · ${stats.waiting}명이 기다리는 중` : ""}`;
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <Stars count={Math.min(others, 30)} />
      <Text style={s.h1}>{title}</Text>
      <Text style={s.muted}>{status}</Text>
      <View style={{ gap: 6 }}>
        <Text style={s.label}>내 이름 (상대에게 보여요)</Text>
        <TextInput style={s.input} value={nick} onChangeText={setNick} maxLength={12} placeholderTextColor={C.dim} />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={s.label}>지금 기분</Text>
        <View style={s.chips}>
          {MOODS.map((m) => <Chip key={m} label={m} on={m === mood} onPress={() => setMood(m)} />)}
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <Pressable style={[s.primary, phase !== "idle" && { opacity: 0.5 }]} disabled={phase !== "idle"} onPress={onFind}>
        <Text style={s.primaryText}>같이 잠들 사람 찾기</Text>
      </Pressable>
      <Text style={s.note}>
        모르는 사람과 목소리로 연결돼요. 전화번호·SNS·사는 곳 같은 개인정보는 나누지 마세요. 불편하면 언제든 ‘차단하고 끝내기’를 누르세요.
      </Text>
    </ScrollView>
  );
}

function Stars({ count }) {
  const stars = useMemo(() => Array.from({ length: count + 1 }, (_, i) => ({
    left: `${(Math.sin(i * 12.9898) * 43758.5453 % 1 + 1) % 1 * 88 + 4}%`,
    top: ((Math.sin(i * 78.233) * 12345.678 % 1 + 1) % 1) * 80 + 6,
    me: i === 0,
  })), [count]);
  return (
    <View style={s.sky}>
      {stars.map((st, i) => (
        <View key={i} style={[s.star, { left: st.left, top: st.top }, st.me && s.starMe]} />
      ))}
    </View>
  );
}

function Waiting({ stats, onCancel }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(y, { toValue: -8, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 2500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    a.start(); return () => a.stop();
  }, [y]);
  return (
    <View style={s.screen}>
      <Animated.View style={[s.moon, { transform: [{ translateY: y }] }]}>
        <View style={s.moonShade} />
      </Animated.View>
      <Text style={[s.h1, { textAlign: "center" }]}>잠 못 드는 사람을{"\n"}기다리는 중</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>
        {stats.awake > 1 ? `깨어 있는 사람 ${stats.awake - 1}명 · 누군가 찾으면 바로 연결돼요.` : "같은 밤을 보내는 누군가가 들어오면 바로 연결돼요."}
      </Text>
      <View style={{ flex: 1 }} />
      <Pressable style={s.ghost} onPress={onCancel}><Text style={s.ghostText}>그만 기다리기</Text></Pressable>
    </View>
  );
}

function CallScreen({ call, log, addLog, sound, chooseSound, asleep, toggleAsleep, timerMin, setTimerMin, patFlash, flashPat, startedAt }) {
  const [text, setText] = useState("");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const live = call.phase === "live";
  const scrollRef = useRef(null);
  const minutes = useMinutes(startedAt, live);

  const sendSay = () => {
    const t = text.trim(); if (!t) return;
    call.send("say", { text: t }); addLog(t, "me"); setText("");
  };

  return (
    <View style={[s.screen, { gap: 14 }]}>
      <View style={s.partnerRow}>
        <View style={{ flex: 1 }}>
          <Text style={s.who} numberOfLines={1}>{call.partner?.nick || "이름 없는 별"}</Text>
          <Text style={s.small}>{call.partner?.mood || ""}</Text>
        </View>
        <View style={[s.pill, live && s.pillLive]}>
          <Text style={[s.pillText, live && { color: C.moss }]}>{live ? `통화 중 · ${minutes}분` : "목소리 잇는 중…"}</Text>
        </View>
      </View>

      <Breath patFlash={patFlash} />

      <View style={{ gap: 6 }}>
        <Text style={s.label}>함께 듣는 소리</Text>
        <View style={s.chips}>
          {Object.entries(SOUND_LABELS).map(([k, l]) => <Chip key={k} label={l} on={sound === k} onPress={() => chooseSound(k)} />)}
        </View>
      </View>

      <ScrollView ref={scrollRef} style={s.log} contentContainerStyle={{ gap: 6 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {log.map((m) => (
          <Text key={m.id} style={[s.msg, m.who === "me" && s.msgMine, m.who === "sys" && s.msgSys]}>{m.text}</Text>
        ))}
      </ScrollView>
      <View style={s.sayRow}>
        <TextInput style={[s.input, { flex: 1 }]} value={text} onChangeText={setText} maxLength={120}
          placeholder="말하기 어려우면 글로 속삭여요" placeholderTextColor={C.dim} onSubmitEditing={sendSay} returnKeyType="send" />
        <Pressable style={s.ghostSm} onPress={sendSay}><Text style={s.ghostText}>보내기</Text></Pressable>
      </View>

      <View style={s.row}>
        <Pressable style={[s.ghostSm, call.muted && s.ghostOn]} onPress={call.toggleMute}>
          <Text style={[s.ghostText, call.muted && { color: C.lamp }]}>{call.muted ? "마이크 꺼짐" : "마이크 끄기"}</Text>
        </Pressable>
        <Pressable style={s.ghostSm} onPress={() => { call.send("pat"); flashPat("토닥토닥 보냈어요"); }}>
          <Text style={s.ghostText}>토닥이기</Text>
        </Pressable>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={s.label}>잠든 뒤 소리·통화 끄기</Text>
        <View style={s.chips}>
          {TIMERS.map((t) => <Chip key={t.m} label={t.l} on={timerMin === t.m} onPress={() => setTimerMin(t.m)} />)}
        </View>
      </View>

      <View style={s.row}>
        <Pressable style={[s.primary, { flex: 1 }]} onPress={toggleAsleep}>
          <Text style={s.primaryText}>{asleep ? "아직 깨어 있어요" : "나 이제 잘게"}</Text>
        </Pressable>
        <Pressable style={[s.ghost, { flex: 1 }]} onPress={() => call.hangup(false)}>
          <Text style={s.ghostText}>통화 끝내기</Text>
        </Pressable>
      </View>
      {confirmBlock ? (
        <View style={s.row}>
          <Text style={[s.small, { flex: 1 }]}>이 사람과 다시 연결되지 않게 할까요?</Text>
          <Pressable onPress={() => call.hangup(true)}><Text style={[s.small, { color: C.lamp }]}>차단하고 끝내기</Text></Pressable>
          <Pressable onPress={() => setConfirmBlock(false)}><Text style={s.small}>취소</Text></Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setConfirmBlock(true)}><Text style={[s.small, { textAlign: "center" }]}>불편한 상대인가요? 차단하기</Text></Pressable>
      )}
    </View>
  );
}

function useMinutes(start, on) {
  const [, force] = useState(0);
  useEffect(() => { if (!on) return; const t = setInterval(() => force((x) => x + 1), 20000); return () => clearInterval(t); }, [on]);
  return start ? Math.floor((Date.now() - start) / 60000) : 0;
}

// 4-7-8 호흡: 두 휴대폰이 같은 시계를 보고 같은 박자로 움직여요
const CYCLE = 19000;
function breathAt(t) {
  if (t < 4000) return { cue: "들이쉬고", scale: 1 + 0.5 * (t / 4000), left: 4 - Math.floor(t / 1000) };
  if (t < 11000) return { cue: "잠깐 멈추고", scale: 1.5, left: 7 - Math.floor((t - 4000) / 1000) };
  return { cue: "천천히 내쉬고", scale: 1.5 - 0.5 * ((t - 11000) / 8000), left: 8 - Math.floor((t - 11000) / 1000) };
}
function Breath({ patFlash }) {
  const scale = useRef(new Animated.Value(1)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const [b, setB] = useState(breathAt(Date.now() % CYCLE));
  useEffect(() => {
    const t = setInterval(() => {
      const nb = breathAt(Date.now() % CYCLE);
      setB(nb);
      Animated.timing(scale, { toValue: nb.scale, duration: 240, easing: Easing.linear, useNativeDriver: true }).start();
    }, 250);
    return () => clearInterval(t);
  }, [scale]);
  useEffect(() => {
    if (!patFlash) return;
    ripple.setValue(0);
    Animated.timing(ripple, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [patFlash, ripple]);
  const showPat = patFlash && Date.now() - patFlash.at < 1800;
  return (
    <View style={s.breath}>
      <Text style={[s.patLabel, { opacity: showPat ? 1 : 0 }]}>{patFlash?.label || ""}</Text>
      <Animated.View style={[s.ripple, { opacity: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }), transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 2.3] }) }] }]} />
      <Animated.View style={[s.orb, { transform: [{ scale }] }]} />
      <Text style={s.bcount}>{b.left}</Text>
      <Text style={s.cue}>{b.cue}</Text>
    </View>
  );
}

function Ended({ text, onAgain, onHome }) {
  return (
    <View style={s.screen}>
      <View style={{ flex: 1 }} />
      <Text style={[s.h1, { textAlign: "center" }]}>통화가 끝났어요</Text>
      <Text style={[s.muted, { textAlign: "center" }]}>{text}</Text>
      <View style={{ flex: 1 }} />
      <Pressable style={s.primary} onPress={onAgain}><Text style={s.primaryText}>다른 사람 찾기</Text></Pressable>
      <Pressable style={s.ghost} onPress={onHome}><Text style={s.ghostText}>처음으로</Text></Pressable>
    </View>
  );
}

function NightOverlay({ onWake }) {
  const [at] = useState(new Date());
  return (
    <View style={s.night}>
      <Text style={s.nightText}>둘 다 잠들었어요.{"\n"}잘 자요.</Text>
      <Text style={s.nightSmall}>{at.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}에 함께 잠들었어요</Text>
      <Pressable onPress={onWake} style={s.nightBtn}><Text style={s.nightSmall}>다시 깼어요</Text></Pressable>
    </View>
  );
}

function Chip({ label, on, onPress }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.ghostOn]} accessibilityState={{ selected: on }}>
      <Text style={[s.ghostText, on && { color: C.lamp }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.ink },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingHorizontal: 20, paddingTop: 8 },
  brand: { color: C.paper, fontFamily: SERIF, fontSize: 18, fontWeight: "700" },
  clock: { color: C.dim, fontSize: 13, fontVariant: ["tabular-nums"] },
  screen: { flexGrow: 1, padding: 20, gap: 18 },
  h1: { color: C.paper, fontFamily: SERIF, fontSize: 28, lineHeight: 38 },
  muted: { color: C.dim, fontSize: 15, lineHeight: 22 },
  small: { color: C.dim, fontSize: 13 },
  label: { color: C.dim, fontSize: 12, letterSpacing: 1 },
  input: { backgroundColor: C.ink2, borderWidth: 1, borderColor: C.line, color: C.paper, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  primary: { backgroundColor: C.lamp, borderRadius: 999, paddingVertical: 15, alignItems: "center" },
  primaryText: { color: "#1b1408", fontSize: 16, fontWeight: "700" },
  ghost: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  ghostSm: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16, alignItems: "center" },
  ghostOn: { borderColor: C.lamp, backgroundColor: C.lampSoft },
  ghostText: { color: C.paper, fontSize: 14 },
  note: { color: C.dim, fontSize: 12.5, lineHeight: 19, borderLeftWidth: 2, borderLeftColor: C.line, paddingLeft: 10 },
  sky: { height: 110, borderBottomWidth: 1, borderBottomColor: C.line },
  star: { position: "absolute", width: 5, height: 5, borderRadius: 3, backgroundColor: C.paper, opacity: 0.8 },
  starMe: { backgroundColor: C.lamp, width: 7, height: 7, borderRadius: 4, opacity: 1 },
  moon: { width: 120, height: 120, borderRadius: 60, backgroundColor: C.paper, alignSelf: "center", marginTop: 30, overflow: "hidden" },
  moonShade: { position: "absolute", width: 120, height: 120, borderRadius: 60, backgroundColor: C.ink, left: 30, top: -10 },
  partnerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  who: { color: C.paper, fontFamily: SERIF, fontSize: 20 },
  pill: { borderWidth: 1, borderColor: C.line, backgroundColor: C.ink2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillLive: { borderColor: "rgba(143,184,163,0.4)" },
  pillText: { color: C.dim, fontSize: 12 },
  breath: { height: 190, alignItems: "center", justifyContent: "center" },
  orb: { width: 96, height: 96, borderRadius: 48, backgroundColor: C.lamp, shadowColor: C.lamp, shadowOpacity: 0.6, shadowRadius: 30, elevation: 8 },
  ripple: { position: "absolute", width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: C.lamp },
  bcount: { position: "absolute", top: 0, right: 0, color: C.dim, fontSize: 12, fontVariant: ["tabular-nums"] },
  cue: { position: "absolute", bottom: 0, color: C.paper, fontFamily: SERIF, fontSize: 17 },
  patLabel: { position: "absolute", top: 4, color: C.lamp, fontSize: 14 },
  log: { flexGrow: 0, maxHeight: 130 },
  msg: { alignSelf: "flex-start", maxWidth: "80%", color: C.paper, backgroundColor: C.ink2, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7, fontSize: 14, overflow: "hidden" },
  msgMine: { alignSelf: "flex-end", backgroundColor: C.lampSoft, borderColor: "rgba(233,184,114,0.35)" },
  msgSys: { alignSelf: "center", backgroundColor: "transparent", borderWidth: 0, color: C.dim, fontSize: 12.5 },
  sayRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  night: { ...StyleSheet.absoluteFillObject, backgroundColor: C.night, alignItems: "center", justifyContent: "center", padding: 24 },
  nightText: { color: "#6b6f80", fontFamily: SERIF, fontSize: 22, textAlign: "center", lineHeight: 34 },
  nightSmall: { color: "#3f4456", fontSize: 13, marginTop: 10 },
  nightBtn: { marginTop: 28, borderWidth: 1, borderColor: "#1c2130", borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
});

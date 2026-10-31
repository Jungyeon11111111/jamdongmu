// 서버 연결 + WebRTC 음성 통화를 담당하는 훅
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
} from "react-native-webrtc";
import { SERVER_URL } from "./config";

// phase: connecting | offline | idle | waiting | calling(연결 중) | live(통화 중) | ended
export function useCall({ deviceId, nick, mood, onSay, onPat, onSound, onPartnerAsleep }) {
  const [phase, setPhase] = useState("connecting");
  const [stats, setStats] = useState({ awake: 0, waiting: 0 });
  const [partner, setPartner] = useState(null);
  const [endReason, setEndReason] = useState(null);
  const [muted, setMuted] = useState(false);

  const socketRef = useRef(null);
  const pcRef = useRef(null);
  const streamRef = useRef(null);
  const iceRef = useRef([]);
  const pendingCandidates = useRef([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const handlers = useRef({});
  handlers.current = { onSay, onPat, onSound, onPartnerAsleep };

  const cleanupPeer = useCallback(() => {
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pendingCandidates.current = [];
    setMuted(false);
  }, []);

  const startPeer = useCallback(async (initiator) => {
    const socket = socketRef.current;
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    pcRef.current = pc;

    const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
    if (pcRef.current !== pc) { stream.getTracks().forEach((t) => t.stop()); return; }
    streamRef.current = stream;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));

    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) socket.emit("signal", { candidate: e.candidate });
    });
    pc.addEventListener("connectionstatechange", () => {
      const s = pc.connectionState;
      if (s === "connected") setPhase("live");
      if (s === "failed") { setEndReason("failed"); socket.emit("hangup", {}); cleanupPeer(); setPhase("ended"); }
    });
    // 상대 목소리 트랙은 react-native-webrtc가 자동으로 재생합니다.

    if (initiator) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      socket.emit("signal", { description: pc.localDescription });
    }
  }, [cleanupPeer]);

  const handleSignal = useCallback(async ({ description, candidate }) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      if (description) {
        await pc.setRemoteDescription(new RTCSessionDescription(description));
        for (const c of pendingCandidates.current) await pc.addIceCandidate(new RTCIceCandidate(c));
        pendingCandidates.current = [];
        if (description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socketRef.current.emit("signal", { description: pc.localDescription });
        }
      } else if (candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(candidate));
        else pendingCandidates.current.push(candidate);
      }
    } catch (e) {
      console.warn("signal error", e);
    }
  }, []);

  // 서버 연결
  useEffect(() => {
    if (!deviceId) return;
    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      auth: { deviceId, nick, mood },
      reconnectionDelay: 1500,
    });
    socketRef.current = socket;

    socket.on("connect", () => setPhase((p) => (p === "connecting" || p === "offline" ? "idle" : p)));
    socket.on("connect_error", () => setPhase((p) => (p === "connecting" ? "offline" : p)));
    socket.on("disconnect", () => {
      if (["calling", "live"].includes(phaseRef.current)) { setEndReason("network"); cleanupPeer(); setPhase("ended"); }
      else setPhase("offline");
    });
    socket.on("hello", ({ iceServers, awake, waiting }) => { iceRef.current = iceServers; setStats({ awake, waiting }); });
    socket.on("stats", setStats);
    socket.on("matched", async ({ partner, initiator }) => {
      setPartner(partner);
      setEndReason(null);
      setPhase("calling");
      try { await startPeer(initiator); }
      catch (e) { setEndReason("mic"); socket.emit("hangup", {}); cleanupPeer(); setPhase("ended"); }
    });
    socket.on("signal", handleSignal);
    socket.on("say", (m) => handlers.current.onSay?.(m.text));
    socket.on("pat", () => handlers.current.onPat?.());
    socket.on("sound", (m) => handlers.current.onSound?.(m.k));
    socket.on("asleep", (m) => handlers.current.onPartnerAsleep?.(m.v));
    socket.on("partner-left", ({ reason }) => { setEndReason(reason === "disconnected" ? "partner-gone" : "partner-left"); cleanupPeer(); setPhase("ended"); });

    return () => { socket.close(); cleanupPeer(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  // 이름·기분이 바뀌면 서버에 알림
  useEffect(() => { socketRef.current?.emit("profile", { nick, mood }); }, [nick, mood]);

  const find = useCallback(() => { setEndReason(null); setPartner(null); setPhase("waiting"); socketRef.current?.emit("find"); }, []);
  const cancel = useCallback(() => { socketRef.current?.emit("cancel"); setPhase("idle"); }, []);
  const hangup = useCallback((block = false, reason) => {
    socketRef.current?.emit("hangup", { block });
    cleanupPeer();
    setEndReason(reason || (block ? "you-blocked" : "you-left"));
    setPhase("ended");
  }, [cleanupPeer]);
  const toggleMute = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);
  const send = useCallback((event, data) => socketRef.current?.emit(event, data), []);

  return { phase, setPhase, stats, partner, endReason, muted, find, cancel, hangup, toggleMute, send };
}

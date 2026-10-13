import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { socket } from "./socket";
import { errorText } from "./messages";
import { useGame } from "./hooks/useGame";
import Lobby from "./screens/Lobby";
import { initialName, saveName } from "./playerName";
import WaitingRoom from "./screens/WaitingRoom";
import Game from "./screens/Game";
import Leaderboard from "./screens/Leaderboard";
import SoloAI from "./screens/SoloAI";
import SetUp from "./screens/SetUp";
import AudioDock from "./components/AudioDock";
import { roomCodeFromSearch } from "./invite";
import Toast from "./components/Toast";

// แปลง URL เป็น "หน้าจอ" — URL คือความจริงว่าตอนนี้อยู่หน้าไหน (ไม่ใช่ state ในหน่วยความจำเหมือนเดิม)
// จึงรีเฟรชแล้วอยู่หน้าเดิม และปุ่มย้อนกลับของเบราว์เซอร์พากลับหน้าก่อนหน้าได้
//   /              หน้าแรก (รับ ?room=12345 จากลิงก์เชิญ)
//   /setup         ตั้งค่าก่อนสร้างห้อง
//   /room/12345    ห้อง (ห้องรอ หรือหน้าเกม แล้วแต่สถานะของห้อง)
//   /leaderboard   อันดับคะแนน
//   /solo          แข่งกับ AI
function parseRoute(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { screen: "lobby" };
  if (path === "/setup") return { screen: "setup" };
  if (path === "/leaderboard") return { screen: "leaderboard" };
  if (path === "/solo") return { screen: "solo" };
  const m = /^\/room\/(\d{5})$/.exec(path);
  if (m) return { screen: "room", code: m[1] };
  return { screen: "unknown" };
}

// App เป็นที่เดียวที่ผูก socket ไว้ หน้าจออื่นรับข้อมูลเป็น props
// ทำแบบนี้เพราะ socket เป็นของกลาง ถ้าต่างคนต่างผูก จะมี listener ซ้ำและลืมถอดออกง่าย
export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const route = parseRoute(location.pathname);
  const routeCode = route.screen === "room" ? route.code : null;

  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState(null); // RoomState ก้อนล่าสุดจาก server
  const [me, setMe] = useState(null); // { playerId, name, avatar, code } ของเครื่องนี้
  const [inGame, setInGame] = useState(false); // อยู่ในห้องแล้วเกมเริ่มหรือยัง (ห้องรอ ↔ หน้าเกม)
  // ชื่อ + อวตารที่เลือกในหน้าแรก อยู่ที่นี่เพื่อให้ติดไปหน้า SET UP / Solo ได้ ไม่ต้องกรอกซ้ำ
  const [profile, setProfile] = useState(() => ({ name: initialName(), avatar: 0 })); // ชื่อ: ที่จำไว้ ไม่งั้นสุ่มให้ (playerName.js)
  // ค่าเริ่ม Solo ที่ส่งมาจากหน้า SET UP (เลือกโหมด "แข่งกับ AI") → SoloAI เริ่มเกมทันทีด้วยความยากนี้
  // null = เข้า /solo ตรง ๆ (เช่นรีเฟรช) จะเห็นหน้ากรอกชื่อตามปกติ
  const [soloBoot, setSoloBoot] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  // me แบบอ่านได้ทันที (ไม่ต้องรอ React วาดรอบใหม่) + socket.id ตอนที่เราเข้าห้องสำเร็จ
  // ถ้า socket.id ตอนนี้ไม่ตรงกับที่จำไว้ แปลว่าหลุดแล้วต่อใหม่ → server ยังไม่รู้ว่า socket ตัวใหม่นี้อยู่ห้องไหน ต้อง rejoin
  const meRef = useRef(null);
  const joinedSidRef = useRef(null);
  const rejoiningRef = useRef(null);

  // เปิดจากลิงก์เชิญ /?room=12345 → หน้าแรกเปิดกล่องใส่รหัสให้เอง
  const inviteCode = route.screen === "lobby" ? roomCodeFromSearch(location.search) : null;

  // สถานะของเกมที่กำลังเล่น ผูก socket ไว้ที่นี่ (ไม่ใช่ในหน้า Game) เพื่อไม่ให้ event หลุด
  // ดูเหตุผลเต็มๆ ในคอมเมนต์ของ useGame
  const {
    game,
    chooseLeft,
    chooseWord,
    sendGuess,
    startGame,
    resetGame,
    // ข้อ 4: ส่งการวาดออก · ขอย้อน/ทำซ้ำ · ผูกกระดานเข้ากับตัวรับ action ของคนอื่น
    sendAction,
    askUndo,
    askRedo,
    askHint,
    bindCanvas,
  } = useGame();

  function showToast(text) {
    setToast({ text, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    // server ส่ง room_update ทุกครั้งที่มีคนเข้าออก แก้ตั้งค่า หรือคะแนนเปลี่ยน
    // หน้าจอแค่เอาค่าที่ได้ไปแสดง ไม่ต้องคำนวณเอง
    const onRoomUpdate = (next) => setRoom(next);
    const onGameStarted = () => setInGame(true);
    // รีเฟรชหลังเกมจบ: server ส่ง game_end กลับมาให้ (ไม่มี game_started) → ต้องอยู่หน้าเกมเพื่อโชว์ผลจบเกม
    const onGameEnd = () => setInGame(true);
    const onGameError = (err) => showToast(errorText(err?.code));
    // ถูกหัวห้องเตะออก — กลับหน้าแรกพร้อมข้อความ · ออกจาก URL ห้องแล้ว effect จะไม่ rejoin กลับเอง
    const onKicked = () => {
      showToast("คุณถูกหัวห้องเชิญออกจากห้อง");
      clearRoom();
      navigate("/");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room_update", onRoomUpdate);
    socket.on("game_started", onGameStarted);
    socket.on("game_end", onGameEnd);
    socket.on("game_error", onGameError);
    socket.on("kicked", onKicked);

    // สำคัญมาก: socket อาจต่อติดไปแล้วก่อนที่ effect นี้จะได้ทำงาน (เกิดจริงตอน dev
    // เพราะ StrictMode ถอด listener ออกแล้วใส่ใหม่) ถ้าพลาด event "connect" ไปแล้ว
    // มันจะไม่ยิงซ้ำอีก ปุ่มจะถูกปิดค้างตลอด จึงต้องอ่านสถานะจริง ณ ตอนนี้ด้วย
    setConnected(socket.connected);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room_update", onRoomUpdate);
      socket.off("game_started", onGameStarted);
      socket.off("game_end", onGameEnd);
      socket.off("game_error", onGameError);
      socket.off("kicked", onKicked);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // จำชื่อล่าสุดที่ใช้ไว้ในเบราว์เซอร์ (พิมพ์เองก็จำ) เปิดครั้งหน้าใช้ชื่อเดิม
  useEffect(() => saveName(profile.name), [profile.name]);

  // ล้างสถานะห้องในเครื่อง (ไม่ได้บอก server — คนเรียกเป็นคนตัดสินใจว่าต้องส่ง leave_room ไหม)
  function clearRoom() {
    meRef.current = null;
    joinedSidRef.current = null;
    resetGame();
    setRoom(null);
    setMe(null);
    setInGame(false);
  }

  // ── URL กับห้องต้องตรงกันเสมอ ──
  // 1) URL ไม่ใช่หน้าห้องแล้ว แต่เรายังอยู่ในห้อง (กดปุ่มย้อนกลับของเบราว์เซอร์) → ออกจากห้อง
  // 2) URL เป็นหน้าห้อง แต่ socket ตัวนี้ยังไม่ได้อยู่ในห้องนั้น (เพิ่งรีเฟรช / เน็ตหลุดแล้วต่อใหม่ / เปิดลิงก์ตรงๆ)
  //    → ขอ rejoin · server จำเราได้จาก playerId แล้วส่งสถานะทั้งหมดกลับมา (ห้อง คะแนน รอบ เวลา ภาพบนกระดาน)
  //    server ไม่รู้จักเรา (ไม่เคยอยู่ห้องนี้ หรือหลุดเกิน 30 วิ) → พาไปหน้าแรกพร้อมกล่องเข้าห้องที่เติมรหัสให้แล้ว
  useEffect(() => {
    if (route.screen === "unknown") {
      navigate("/", { replace: true });
      return;
    }
    if (!routeCode) {
      if (meRef.current) {
        socket.emit("leave_room");
        clearRoom();
      }
      return;
    }
    if (!connected) return; // ยังต่อ server ไม่ติด รอ connect ก่อน (effect นี้จะทำงานอีกรอบเอง)
    const inPlace = meRef.current?.code === routeCode && joinedSidRef.current === socket.id;
    const key = `${socket.id}:${routeCode}`;
    if (inPlace || rejoiningRef.current === key) return;
    rejoiningRef.current = key;

    socket.timeout(6000).emit("rejoin", { code: routeCode }, (err, res) => {
      if (rejoiningRef.current === key) rejoiningRef.current = null;
      if (err) return showToast(errorText("CONNECT_FAILED"));
      if (res?.ok) {
        const info = { playerId: res.playerId, name: res.name, avatar: res.avatar, code: res.code };
        meRef.current = info;
        joinedSidRef.current = socket.id;
        setMe(info);
        setProfile((p) => ({ ...p, name: res.name, avatar: res.avatar }));
        return;
      }
      clearRoom();
      if (res?.error === "NOT_IN_ROOM") return navigate(`/?room=${routeCode}`, { replace: true });
      showToast(errorText(res?.error));
      navigate("/", { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, routeCode, route.screen]);

  function handleEntered(info) {
    // เข้าห้องสำเร็จด้วยชื่อนี้ (อาจเป็นชื่อที่ต่อเลขให้หลังชื่อซ้ำ) → ใช้ชื่อนี้ต่อไป
    setProfile((p) => (p.name === info.name ? p : { ...p, name: info.name }));
    meRef.current = info;
    joinedSidRef.current = socket.id;
    setMe(info);
    setInGame(false);
    // ไปหน้าห้อง · มาจากหน้า SET UP หรือลิงก์เชิญ ให้ "แทนที่" หน้านั้นในประวัติ
    // กดย้อนกลับจากห้องจะได้กลับหน้าแรก ไม่ใช่กลับไปหน้าที่เพิ่งกดสร้าง/เข้าห้องซ้ำ
    const replace = location.pathname !== "/" || location.search !== "";
    navigate(`/room/${info.code}`, { replace });
  }

  function handleLeave() {
    socket.emit("leave_room");
    clearRoom();
    navigate("/");
  }

  const goHome = () => navigate("/");
  // อยู่ที่ URL ของห้อง และข้อมูลห้องนั้นมาถึงแล้ว
  const roomReady = route.screen === "room" && me && room && room.code === routeCode;
  const showGame = roomReady && inGame;

  return (
    <>
      {/* ปุ่มเพลง/เสียงเอฟเฟกต์: หน้าเกม/Solo/ห้องรอ อยู่ในแถบบนของหน้านั้นเอง หน้าอื่นลอยมุมขวาบนของหน้า */}
      {!roomReady && route.screen !== "solo" && <AudioDock />}
      {route.screen === "lobby" && (
        <Lobby
          key={inviteCode ?? "home"} // ลิงก์เชิญเปลี่ยน = สร้างหน้าใหม่ให้กล่องเข้าห้องเปิดพร้อมรหัสนั้น
          connected={connected}
          profile={profile}
          onProfile={setProfile}
          inviteCode={inviteCode}
          onEntered={handleEntered}
          // หน้า Lobby ส่ง "รหัส error" มา ที่นี่แปลงเป็นข้อความไทยก่อนโชว์
          onError={(code) => showToast(errorText(code))}
          onOpenSetup={() => navigate("/setup")}
        />
      )}

      {/* SET UP: เลือกโหมด/รอบ/เวลา/ความยาก/ประเภทห้อง แล้วสร้างห้อง */}
      {route.screen === "setup" && (
        <SetUp
          connected={connected}
          profile={profile}
          onProfile={setProfile}
          onBack={goHome}
          onEntered={handleEntered}
          onError={(code) => showToast(errorText(code))}
          // เลือกโหมด "แข่งกับ AI" แล้วกดเริ่มเกม → ไปหน้า Solo แล้วเริ่มทันทีด้วยความยากที่เลือก
          onStartSolo={(difficulty) => {
            setSoloBoot({ difficulty });
            navigate("/solo");
          }}
        />
      )}

      {/* Leaderboard ไม่ได้ใช้ socket เลย ขอข้อมูลผ่าน HTTP เอง */}
      {route.screen === "leaderboard" && <Leaderboard onBack={goHome} />}

      {/* Solo ผูก socket event ของตัวเองในหน้านั้น (ไม่เกี่ยวกับห้อง) */}
      {route.screen === "solo" && (
        <SoloAI
          initialName={profile.name}
          boot={soloBoot}
          onName={(name) => setProfile((p) => ({ ...p, name }))}
          onBack={() => {
            setSoloBoot(null);
            goHome();
          }}
        />
      )}

      {/* room ยังมาไม่ถึง (กำลัง rejoin หลังรีเฟรช) ก็มีให้เห็นว่ากำลังทำอะไรอยู่ ไม่ใช่จอเปล่า */}
      {route.screen === "room" && !roomReady && (
        <div className="screen">
          <div className="panel">{connected ? "กำลังเข้าห้อง..." : "กำลังต่อ server..."}</div>
        </div>
      )}

      {roomReady && !inGame && <WaitingRoom room={room} me={me} onLeave={handleLeave} />}

      {showGame && (
        <Game
          room={room}
          meId={me.playerId}
          game={game}
          chooseLeft={chooseLeft}
          chooseWord={chooseWord}
          sendGuess={sendGuess}
          startGame={startGame}
          sendAction={sendAction}
          askUndo={askUndo}
          askRedo={askRedo}
          askHint={askHint}
          bindCanvas={bindCanvas}
          onLeave={handleLeave}
          // Toast ตัวกลางอยู่ที่ App หน้าเกมจึงขอยืมใช้ (เช่นตอนกดคัดลอกรหัสห้อง)
          onToast={showToast}
        />
      )}

      {/* หลุดจาก server ระหว่างอยู่ในห้อง: บอกให้รู้ว่ากำลังต่อใหม่ (ต่อติดแล้ว rejoin เองโดยอัตโนมัติ) */}
      {roomReady && !connected && <div className="reconnect-note">การเชื่อมต่อหลุด กำลังต่อใหม่...</div>}

      {/* key ผูกกับ id ของ toast เพื่อให้แสดงข้อความซ้ำแล้วเล่นอนิเมชันใหม่ */}
      <Toast key={toast?.id ?? "none"} toast={toast} />
    </>
  );
}

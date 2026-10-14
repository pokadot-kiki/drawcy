# DRAW.CY

เกมวาดรูปทายคำแบบ multiplayer (เหมือน Gartic.io / Skribbl.io) ทำโดยทีม **TATA.IO**
โปรเจกต์วิชา CP422011 เครือข่ายคอมพิวเตอร์ขั้นแนะนำ มหาวิทยาลัยขอนแก่น — จุดประสงค์คือศึกษาการสื่อสารแบบ real-time ผ่าน WebSocket และสถาปัตยกรรม client-server

คนหนึ่งเป็นคนวาด คนอื่นเห็นภาพสดๆ แล้วพิมพ์ทายในแชท ทายถูกเร็วได้คะแนนเยอะ สลับกันวาดจนครบรอบ
จุดที่ต่างจากเกมเดิมคือ **Mini Challenge** กติกาพิเศษที่สุ่มเข้ามาบางตา

## มีอะไรบ้าง

| โหมด | เล่นยังไง |
|---|---|
| **แข่งเดี่ยว** (2–8 คน) | ทุกคนแข่งกันเอง ผลัดกันวาด คนอื่นพิมพ์ทาย ทายถูกเร็วได้คะแนนเยอะ |
| **โหมดทีม** (เลือก 2/3/4 ทีม · ทีมละ 2 คนขึ้นไป · ทุกทีมคนต่างกันไม่เกิน 1) | แบ่งทีมให้สมดุล (เช่น 5 คน = 3+2) คนวาดของทุกทีมวาด**คำเดียวกันพร้อมกัน** ทีมไหนทายถูกก่อนได้โบนัส +100 |
| **Solo แข่งกับ AI** (คนเดียว) | ช่วงแรกเราวาด AI ทาย · ช่วงสอง AI "วาด" (เล่นซ้ำภาพที่คนจริงเคยวาด) เราพิมพ์ทาย · ด่านยากขึ้นเรื่อยๆ มี 3 ชีวิต · คะแนนขึ้น Leaderboard |

**Mini Challenge** (สุ่มบางตา ตาแรกของเกมไม่มีเสมอ และไม่ติดกันสองตา):
**Colour Fix** วาดได้สีเดียว · **Don't Lift Pen** วาดเส้นเดียวต่อเนื่อง ห้ามยกปากกา

เครื่องมือวาด: ปากกา ยางลบ ถังสี (จานสี 20 สี + เลือกสีเอง) เส้นตรง/สี่เหลี่ยม/วงกลม ย้อนกลับ/ทำซ้ำ ·
มี **Leaderboard** ประจำเดือน (เดือนนี้ตามเวลาไทย เริ่มใหม่ทุกเดือน) · เชิญเพื่อนด้วยรหัสห้อง 5 หลักหรือลิงก์ · ใช้บนไอแพด (นิ้ว/Apple Pencil) ได้

## ติดตั้ง

ต้องมี **Node.js 20 ขึ้นไป** ([ดาวน์โหลด](https://nodejs.org)) และอินเทอร์เน็ต (ตอนติดตั้งครั้งแรก)

```bash
git clone <ที่อยู่ repo นี้>
cd justdrawit
npm run setup
```

`npm run setup` ทำให้ครบในคำสั่งเดียว: ติดตั้งแพ็กเกจของ `server/` และ `client/` → ดาวน์โหลดโมเดล AI ของโหมด Solo (~21 MB) → build หน้าเว็บเป็น `client/dist`
รันซ้ำได้ปลอดภัย (ของที่มีแล้วจะข้าม) — **ถ้าดาวน์โหลดโมเดลไม่ได้** (ไม่มีเน็ตหรือโดนบล็อก) ตัวติดตั้งจะเตือนแล้วทำต่อ
เกมเปิดได้ปกติ โหมด Solo จะใช้ "โหมดจำลอง" (AI เดาสุ่ม) ภายหลังต่อเน็ตแล้วรัน `cd server && npm run get-model` เพื่อได้ AI ตัวจริง

## เปิดเกม

```bash
npm start
```

จะเห็นข้อความประมาณนี้:

```
server พร้อมแล้ว ที่ http://localhost:3000
ให้เพื่อนในวง Wi-Fi เดียวกันพิมพ์ที่อยู่นี้ในเบราว์เซอร์:
   http://192.168.1.23:3000
AI Solo: โหมด model
```

เปิด **http://localhost:3000** ในเบราว์เซอร์แล้วเล่นได้เลย (หยุดเกม: กด `Ctrl+C`) — เปลี่ยนพอร์ตได้ด้วย `PORT=4000 npm start`

## ให้เพื่อนเข้าเล่น

### เพื่อนอยู่ในวง Wi-Fi เดียวกัน

1. รัน `npm start` ที่เครื่องของคุณ
2. ให้เพื่อนพิมพ์ที่อยู่ `http://192.168.x.x:3000` ที่ server พิมพ์ไว้ (ตัวเลขเป็นของเครื่องคุณ) ในเบราว์เซอร์ของเขา
3. สร้างห้อง แล้วส่ง**รหัสห้อง 5 หลัก**หรือปุ่มคัดลอกลิงก์เชิญให้เพื่อน

ถ้าเพื่อนเข้าไม่ได้:
- **Wi-Fi มหาวิทยาลัยมักตั้งให้เครื่องมองไม่เห็นกัน** (client isolation) → ให้คุณ**เปิด hotspot จากมือถือ** แล้วทุกคนต่อ Wi-Fi ของมือถือเครื่องนั้น จากนั้นรัน `npm start` ใหม่ (IP จะเปลี่ยน)
- macOS ถามว่ายอมให้ Node รับการเชื่อมต่อขาเข้าไหม → กด **อนุญาต** (หรือเช็ค System Settings → Network → Firewall)
- เครื่องต้องอยู่ Wi-Fi เดียวกันจริง (ชื่อเครือข่ายเดียวกัน ไม่ใช่ guest คนละวง)

### เพื่อนอยู่คนละที่ (ผ่านอินเทอร์เน็ต ชั่วคราว)

ใช้ **Cloudflare quick tunnel** (ฟรี ไม่ต้องสมัครบัญชี) ต้องติดตั้งโปรแกรม `cloudflared` ครั้งเดียว:

```bash
brew install cloudflared      # macOS (ระบบอื่น: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
npm run share
```

`npm run share` เปิดเกมให้ (ถ้ายังไม่ได้เปิด) แล้วเปิดอุโมงค์ไปที่พอร์ต 3000 จากนั้นพิมพ์ลิงก์หน้าตา `https://xxxx-xxxx.trycloudflare.com` — ส่งให้เพื่อนเปิดในเบราว์เซอร์ได้เลย
- ลิงก์ใช้ได้ตราบที่หน้าต่างนั้นยังเปิดอยู่ กด `Ctrl+C` = ปิดลิงก์ทันที (และเปลี่ยนใหม่ทุกครั้งที่รัน)
- ใครมีลิงก์ก็เข้าได้ — อย่าโพสต์ในที่สาธารณะ · เป็นบริการฟรีแบบไม่รับประกันความเสถียร เหมาะกับเล่นชั่วคราว/เดโม่

### เปิดเป็นเว็บถาวรบนอินเทอร์เน็ต (ไม่ต้องเปิดเครื่อง)

ขึ้นเว็บฟรีด้วย **Render + Upstash Redis** (เก็บคะแนนไม่ให้หาย) ได้ลิงก์ถาวร `https://....onrender.com` — ดูขั้นตอนทีละขั้นที่ [`DEPLOY.md`](DEPLOY.md)
(แพ็กเกจฟรีหลับถ้าไม่มีคนเข้า 15 นาที ปลุกใช้เวลา ~1 นาที · ตัวแปรที่ใช้: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `HOST`, `FORCE_HTTPS`)

## ภาพรวมระบบ

```
เบราว์เซอร์ (React + Canvas)  ◄────── WebSocket (Socket.IO) ──────►  server (Node.js + Express + Socket.IO)
  วาด/แสดงภาพ ส่งอินพุต                                                  • ห้อง (Map) แยกกันด้วย Socket.IO room
  ไม่ตัดสินอะไรเอง                                                        • ตัดสินกติกา คะแนน เวลา ทุกอย่าง (server-authoritative)
                                                                         • Leaderboard เก็บเป็นไฟล์ JSON (server/data/scores.json)
  ◄───── HTTP: หน้าเว็บ (client/dist) + /api/leaderboard ─────           • โหมด Solo: โมเดลทายภาพ (ONNX) ในเครื่อง
                                                                           → ถ้าไม่มีโมเดล: Claude API (ถ้าใส่ key) → โหมดจำลอง
```

- **สัญญาระหว่างหน้าเว็บกับ server** อยู่ที่ [`events.md`](events.md) (ชื่อ event และหน้าตาข้อมูลทุกตัว)
- ภาพวาดเดินทางเป็น "การกระทำ" (เริ่มเส้น/จุด/จบเส้น/เทสี/รูปทรง) พิกัดเป็นสัดส่วน 0–1 จอทุกขนาดจึงเห็นตรงกัน; server เก็บประวัติเพื่อย้อนกลับ/ทำซ้ำและส่งให้คนที่เข้าห้องกลางตา
- **กันโกง**: คำตอบไม่เคยถูกส่งให้คนทาย (ตอนจบตาจึงเฉลย) · ทุก input เช็คที่ server · server ไม่พิมพ์คำตอบลง log · CORS/WebSocket รับเฉพาะ origin ที่จำเป็น (เครื่องตัวเอง · วงแลน · `*.trycloudflare.com`)
- ผู้พัฒนา: [`CLAUDE.md`](CLAUDE.md) (กติกาโปรเจกต์/สถานะงาน) · [`DESIGN.md`](DESIGN.md) (ธีม/หน้าจอ) · หน้าทดสอบ server `http://localhost:3000/test.html`

โครงโฟลเดอร์: `server/` (เกมฝั่ง server, โมเดล, ข้อมูล, เทส) · `client/` (React + Vite) · `scripts/` (setup / share)

## คำสั่งสำหรับผู้พัฒนา

```bash
npm test                      # เทสอัตโนมัติของ server (~4 นาที) — ต้องไม่มีอะไรเปิดอยู่บนพอร์ต 3000
cd client && npm run dev      # โหมดพัฒนาหน้าเว็บ http://localhost:5173 (ต้องเปิด npm start ไว้ด้วย)
cd client && npm run build    # build หน้าเว็บใหม่ (ต้อง build ทุกครั้งที่แก้โค้ด client ถ้าเล่นผ่านพอร์ต 3000)
cd server && npm run seed     # ใส่คะแนนตัวอย่างลง Leaderboard (มีอยู่แล้วไม่ทับ)
```

ตัวเลือกเสริมใน `server/.env` (คัดลอกจาก `server/.env.example`): `ANTHROPIC_API_KEY` ให้ Solo ใช้ Claude ดูภาพแทนโมเดลในเครื่อง (ไม่จำเป็น) ·
ตัวแปรสภาพแวดล้อม `PORT`, `ALLOWED_ORIGINS` (เพิ่มโดเมนที่อนุญาตให้ต่อ socket, คั่นด้วยจุลภาค), `HOST`, `FORCE_HTTPS=1`, `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (เก็บ Leaderboard ใน Upstash แทนไฟล์)

## โมเดล AI ของโหมด Solo (ฟรี รันในเครื่อง ไม่ต้องมี API key)

server รันโมเดลจำแนกภาพวาดที่ฝึกจากชุดข้อมูล Quick, Draw! ด้วย `onnxruntime-node` (หน้าเว็บไม่ได้ตัดสินอะไร) ไฟล์ ~20 MB **ไม่ได้ commit**
ดาวน์โหลดโดย `npm run setup` (หรือ `cd server && npm run get-model` ซึ่งเช็คว่าโมเดลเป็นสัญญา MIT ก่อนทุกครั้ง ไม่ใช่ = หยุด) ตอนสตาร์ทจะพิมพ์ `AI Solo: โหมด model` ถ้าโหลดติด
ลำดับสมอง: **โมเดลในเครื่อง → Claude API (ถ้ามี key) → โหมดจำลอง** โหลดไม่ได้หรือพังกลางทางก็ถอยไปตัวถัดไป server ไม่ล่ม
ช่วงสองของ Solo เล่นซ้ำภาพคนจริงจาก `server/data/ai-drawings.json` (**ไม่ใช่ AI สร้างภาพเอง**) สร้างใหม่ได้ด้วย `cd server && npm run get-drawings` (~3 นาที)

## เครดิต

- **โมเดล**: [VinayHajare/quickdraw-mobilevit-small-onnx](https://huggingface.co/VinayHajare/quickdraw-mobilevit-small-onnx) สัญญาอนุญาต MIT (ปรับต่อจาก MobileViT-Small ของ Apple)
- **ชุดข้อมูล**: [Google Quick, Draw! Dataset](https://github.com/googlecreativelab/quickdraw-dataset) สัญญาอนุญาต CC BY 4.0 — ใช้ฝึกโมเดล และภาพวาดในช่วง "AI วาด" (`server/data/ai-drawings.json`) คัดและแปลงพิกัดจากชุดเดียวกัน เป็นผลงานของผู้เล่นทั่วโลกที่ร่วมวาดให้ชุดข้อมูลนี้
- **ฟอนต์** (Google Fonts สัญญาอนุญาต SIL Open Font License 1.1 · หน้าเว็บโหลดจาก Google Fonts จึงต้องมีอินเทอร์เน็ตตอนเปิดครั้งแรก ไม่มีเน็ตจะใช้ฟอนต์สำรองของเครื่อง): [Jersey 15](https://fonts.google.com/specimen/Jersey+15) (Sarah Cadigan-Fried) · [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch) และ [Prompt](https://fonts.google.com/specimen/Prompt) (Cadson Demak)
- **เพลงพื้นหลัง**: [Children's March Theme](https://opengameart.org/content/childrens-march-theme) โดย Cleyton Kauffman ([SoundCloud](https://soundcloud.com/cleytonkauffman)) จาก OpenGameArt.org สัญญาอนุญาต [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (ไม่บังคับให้เครดิต แต่ใส่ไว้เพื่อขอบคุณ) · ไฟล์อยู่ที่ `client/public/music/` เกมวนเล่นซ้ำเพลงนี้ ถ้าอยากเปลี่ยน/เพิ่มเพลง แค่ใส่ไฟล์ (.mp3 .ogg .wav .m4a) ในโฟลเดอร์เดียวกัน; ไม่มีไฟล์เพลงเลยปุ่มเพลงจะหายไปเอง
- **ไอคอน ตัวการ์ตูน มาสคอต เสียงเอฟเฟกต์ ภาพประกอบ**: วาด/สร้างเองโดยทีม (พิกเซลอาร์ตจากโค้ด เสียงสร้างสดด้วย Web Audio)
- **ไลบรารี**: React, React Router, Vite, Express, Socket.IO, onnxruntime-node, sharp, dotenv (สัญญาอนุญาตของแต่ละตัวตามต้นทาง)

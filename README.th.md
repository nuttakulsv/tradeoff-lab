# tradeoff-lab

[English](README.md) | ภาษาไทย

ระบบสั่งซื้อตัวเดียวกัน ทำขึ้นสองแบบ แบบแรกเป็น modular monolith แบบที่สองเป็น microservices ที่คุยกันผ่าน event จากนั้นยิงโหลดใส่และตั้งใจทำให้พังทั้งคู่ เอาไว้คุยเรื่องสถาปัตยกรรมกันด้วยตัวเลข แทนที่จะเถียงกันด้วยความรู้สึก

[![CI](https://github.com/nuttakulsv/tradeoff-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/nuttakulsv/tradeoff-lab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![NestJS 12](https://img.shields.io/badge/NestJS-12-e0234e)
![NATS JetStream](https://img.shields.io/badge/NATS-JetStream-27aae1)

![กรณีปกติ: ออเดอร์ที่ยืนยันได้ต่อวินาที และเวลาที่ลูกค้ารอจนได้คำตอบ](docs/charts/baseline.svg)

|                                                   | Modular monolith | Microservices + events |
| ------------------------------------------------- | ---------------: | ---------------------: |
| ออเดอร์ที่ยืนยันได้ต่อวินาที (ลูกค้า 64 คน)       |        **1,140** |                    456 |
| เวลารอจนได้คำตอบสุดท้าย p95                       |        **68 ms** |                 191 ms |
| ระบบจ่ายเงินล่ม 10 วินาที: ออเดอร์ที่ถูกปฏิเสธ    |              320 |                  **0** |
| ระบบจ่ายเงินล่ม 10 วินาที: ลูกค้าที่รอนานที่สุด   |        **0.5 s** |                 12.3 s |
| `kill -9` กลางคัน: request ที่ล้มเหลว             |            1,556 |                  **0** |
| สต็อกขายเกิน ตัดเงินซ้ำ ออเดอร์หาย (ทุก scenario) |                0 |                      0 |
| หน่วยความจำตอนว่าง                                |       **111 MB** |  511 MB + broker 33 MB |
| ตัวที่ต้อง deploy / container / env var           |    **1 / 3 / 3** |             5 / 8 / 16 |

วัดบน Apple M2 (8 คอร์ RAM 8 GB) เครื่องเดียว ทุกอย่างรันในเครื่อง ตารางเต็มอยู่ใน [results/summary.md](results/summary.md) วิธีวัดอยู่ด้านล่าง

ไม่มีฝั่งไหนชนะขาด monolith เร็วกว่า เล็กกว่า และดูแลง่ายกว่า ส่วนแบบ event-driven ไม่ปฏิเสธลูกค้าเลยสักคนตอนที่ระบบที่พึ่งพาอยู่ล่ม แต่แลกมากับการให้ลูกค้าบางคนรอ จะให้น้ำหนักกับอะไรมากกว่าเป็นการตัดสินใจทางธุรกิจ และนั่นคือสิ่งที่ repo นี้อยากให้เห็น

## เริ่มใช้งาน

```bash
git clone https://github.com/nuttakulsv/tradeoff-lab.git
cd tradeoff-lab && npm install
npm run lab -- contract all
```

```console
monolith: up in 479 ms, running contract tests
 Test Files  1 passed (1)
      Tests  11 passed (11)
microservices: up in 486 ms, running contract tests
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

ไม่ต้องมี Docker ตัว lab จะเปิด PostgreSQL 18 ตัวจริงผ่าน package [`embedded-postgres`](https://github.com/leinelissen/embedded-postgres) และโหลด `nats-server` เวอร์ชันที่ล็อกไว้มาเก็บใน `.lab/` ต้องใช้ Node 22.12 ขึ้นไป

| คำสั่ง                         | ทำอะไร                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| `npm run lab -- contract all`  | รัน contract test แบบ black-box กับทั้งสองแบบ                           |
| `npm run lab -- run all crash` | รัน scenario เดียวกับทั้งสองแบบ (ใส่ `--quick` เพื่อรันแค่ 20% ของเวลา) |
| `npm run bench`                | รันทุก scenario ทั้งสองแบบ แล้วสร้างรายงานกับกราฟใหม่ (ประมาณ 9 นาที)   |
| `npm run lab -- up monolith`   | เปิดแบบที่เลือกทิ้งไว้ที่ port 4000 (microservices ใช้ 4100)            |

ถ้าจะใช้ Docker:

```bash
docker compose --profile monolith up --build --wait        # http://localhost:4000
docker compose --profile microservices up --build --wait   # http://localhost:4100
```

## เทียบอะไรกับอะไร

ร้านค้าเล็ก ๆ ร้านหนึ่ง สั่งซื้อได้ (จองสต็อก ตัดเงินผ่าน payment provider แล้วยืนยัน) ยกเลิกได้ (คืนเงิน คืนสต็อก) ดูออเดอร์ได้ และมีแจ้งเตือนเมื่อยืนยัน ทั้งสองแบบใช้ [OpenAPI spec](openapi.yaml) ตัวเดียวกัน และต้องผ่าน [contract test](contract/orders.contract.ts) ชุดเดียวกัน

**Modular monolith** NestJS process เดียว แบ่ง module เป็น orders, inventory, payments, notifications แต่ละ module มี schema ของตัวเองใน PostgreSQL ก้อนเดียว ตอนสั่งซื้อ ระบบจองสต็อกใน transaction เดียวกับการสร้างออเดอร์ เรียก payment provider แล้วตอบ `201 CONFIRMED` หรือ `201 REJECTED` ทันที ถ้า process ตายกลางคัน จะมี recovery job มาเก็บงานให้จบ

**Microservices แบบ event-driven** ห้า process (gateway, orders, inventory, payments, notifications) ฐานข้อมูลสี่ก้อน คั่นกลางด้วย NATS JetStream ตัว orders ตอบ `202 PENDING` กลับไปก่อน แล้วให้ saga พาออเดอร์ไปจนถึงสถานะสุดท้าย ทุก service มี outbox, consumer ทุกตัว idempotent และมี compensation เมื่อจ่ายเงินไม่ผ่าน

ดู sequence diagram ของทั้งสองแบบได้ที่ [docs/architecture.md](docs/architecture.md) ส่วนที่ใช้ร่วมกัน (schema ของ request, SQL, client ของ payment) อยู่ใน `src/shared/` ผลต่างที่ออกมาจึงมาจากโครงสร้าง ไม่ได้มาจากว่าฝั่งไหนเขียน query เก่งกว่า ([เหตุผล](docs/decisions/0004-shared-code.md))

## วิธีวัด

- ใช้ load generator แบบ closed loop ([harness/load.ts](harness/load.ts)) ลูกค้าจำลองแต่ละคนสั่งของ แล้ว poll ทุก 50 ms จนออเดอร์เป็น CONFIRMED หรือ REJECTED ค่อยสั่งชิ้นถัดไป "เวลารอจนได้คำตอบ" คือเวลาที่ลูกค้ารอจริง ฝั่ง 202 จะรวมเวลาที่เสียไปกับการ poll ด้วย ใน[ผลเต็ม](results/summary.md)จึงมีเวลาฝั่ง server ที่ไม่รวมการ poll ให้ดูด้วย
- จบแต่ละ scenario แล้ว [harness/check.ts](harness/check.ts) จะเปิดดูฐานข้อมูลกับสมุดบัญชีของ payment provider เพื่อนับว่ามีออเดอร์ค้าง ออเดอร์ซ้ำ สต็อกหายหรือขายเกิน เงินถูกตัดแต่ไม่มีออเดอร์ ออเดอร์ยืนยันแต่ไม่ได้เงิน หรือไม่ได้แจ้งลูกค้าบ้างไหม ทุก run ใน README นี้ผ่านทุกข้อ
- payment provider ปลอมตอบใน 50 ms เป็นค่าเริ่มต้น และสั่งให้ช้า ให้ error หรือให้ล่มระหว่างรันได้
- ทุก scenario เริ่มจากฐานข้อมูลเปล่าและ broker ใหม่

| Scenario                | เกิดอะไรขึ้น                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| baseline-c1 / c16 / c64 | กรณีปกติ ลูกค้า 1, 16 และ 64 คน นาน 20 วินาที                                                             |
| hot-item                | ลูกค้า 32 คนแย่งกันซื้อกล่องขนมไหว้พระจันทร์ที่มี 100 กล่อง                                               |
| slow-payment            | payment provider ใช้เวลา 2 วินาทีต่อครั้ง                                                                 |
| payment-outage          | payment provider ล่มตั้งแต่วินาทีที่ 5 ถึง 15                                                             |
| crash                   | `kill -9` โค้ดส่วน inventory ที่วินาทีที่ 8 แล้วเปิดใหม่ที่วินาทีที่ 13 ฝั่ง monolith หมายถึงทั้ง process |
| duplicates              | ทุก HTTP request ถูกส่งซ้ำสองครั้งพร้อมกัน และฝั่ง microservices ทุก event ถูก publish ซ้ำสองครั้ง        |

## ผลลัพธ์

กรณีปกติ monolith ทำออเดอร์ต่อวินาทีได้ 2 ถึง 2.5 เท่า และตอบเร็วกว่าครึ่งหนึ่ง เพราะออเดอร์ฝั่ง event-driven ต้องผ่านสี่ทอดก่อนจะยืนยันได้ (transaction, outbox poll, broker ทุกทอด) ถึง POST จะตอบกลับเร็วกว่า (p95 10 ถึง 25 ms) แต่ก็แค่ทำให้ลูกค้าเริ่มรอเร็วขึ้นเท่านั้น

ถ้าคอขวดอยู่ที่ API ของคนอื่น สถาปัตยกรรมไม่ช่วยเรื่อง throughput เลย ตอน payment provider ใช้ 2 วินาที ทั้งสองแบบทำได้ราว 15 ออเดอร์ต่อวินาทีกับลูกค้า 32 คน และรอราว 2.1 ถึง 2.4 วินาทีต่อออเดอร์เท่า ๆ กัน

ตอนแย่งซื้อของ hot-item ทั้งสองแบบขายได้ 100 กล่องพอดี และใน scenario duplicates ไม่มีใครโดนตัดเงินซ้ำ

### ตอนที่ระบบพัง

![payment provider ล่ม 10 วินาที](docs/charts/outage.svg)

ตอน payment provider ล่ม monolith ทำตามที่การเรียกแบบ synchronous ควรเป็น คือลองสามครั้งในราว 0.45 วินาที แล้วปฏิเสธออเดอร์ด้วย `PAYMENT_UNAVAILABLE` ออกมา 320 ออเดอร์ แต่ลูกค้าทุกคนได้คำตอบภายในครึ่งวินาที ฝั่ง event-driven เก็บออเดอร์ไว้เป็น PENDING แล้ว retry แบบ backoff ไปเรื่อย ๆ ไม่มีใครถูกปฏิเสธ ลูกค้า 16 คนต้องรอนานสุด 12.3 วินาที และทุกออเดอร์ได้รับการยืนยันในที่สุด หลัง provider กลับมา ใช้เวลาอีกราว 2 วินาทีกว่าจะตามทัน เพราะ backoff

![kill -9 โค้ดส่วน inventory](docs/charts/crash.svg)

kill monolith คือทุกอย่างหยุดหมด request ล้มเหลว 1,556 ตัวช่วงที่ process หายไป ออเดอร์ที่ค้างอยู่กลางการจ่ายเงินถูก recovery job เก็บจบราว 6 วินาทีหลังเปิดใหม่ ส่วนการ kill เฉพาะ inventory service ไม่มี request ไหนล้มเลย แต่การยืนยันออเดอร์หยุดทุกคน เพราะทุกออเดอร์ต้องใช้สต็อก ลูกค้า 16 คนรอนานสุด 10.2 วินาที ช่วงที่กราฟค่อย ๆ ไต่ขึ้นหลังเปิดใหม่คือผลของ `ack_wait` ใน JetStream ข้อความที่ process ตายถือค้างไว้จะถูกส่งใหม่หลัง 10 วินาที ตอนใช้ค่า default ของ NATS ที่ 30 วินาที มี run ก่อนหน้า (แบบสั้น) ที่ใช้เวลาฟื้น 29 วินาที และมีอีก run ที่ฟื้นใน 22 ms เพราะตอน kill ไม่มีข้อความค้างอยู่เลย ผลของ crash ขึ้นกับจังหวะ ควรรันมากกว่าหนึ่งรอบ

### ต้นทุนในการรันและการแก้

|                                                    | Monolith | Microservices |
| -------------------------------------------------- | -------: | ------------: |
| TypeScript ของตัวเอง (ไม่นับบรรทัดว่างและ comment) |      411 |           707 |
| โค้ดที่ใช้ร่วมกัน                                  |      375 |           375 |
| ตัวที่ต้อง deploy                                  |        1 |             5 |
| Container ใน docker-compose                        |        3 |             8 |
| Environment variable ของแอป                        |        3 |            16 |
| ฐานข้อมูล / broker                                 |    1 / 0 |         4 / 1 |
| เวลา cold start ทุก process                        |   370 ms |        556 ms |
| เพิ่ม discount code: ไฟล์ / บรรทัดที่แก้           |   3 / 51 |        4 / 69 |

การเพิ่ม discount code ([exercises/discount-code](exercises/discount-code)) อยู่ใน context เดียวทั้งสองฝั่ง ผลต่างเลยไม่มาก CI จะ apply patch ทั้งสองแล้วรัน contract test ทุกครั้ง patch จึงไม่ตกยุค งานที่ข้าม context เป็น exercise ถัดไปที่ควรเพิ่ม

ค่าใช้จ่าย cloud ต่อเดือนโดยประมาณ สำหรับ production ขนาดเล็กที่มีตัวสำรอง คิดจาก[ราคาของ DigitalOcean](https://www.digitalocean.com/pricing/droplets) (เช็กเมื่อ 3 ตุลาคม 2026) ที่ 1 USD = 33.5 บาท (อัตราตลาดวันที่ 2 ตุลาคม 2026)

|                                                                                                |                Monolith |                     Microservices |
| ---------------------------------------------------------------------------------------------- | ----------------------: | --------------------------------: |
| เครื่องแอป                                                                                     |    2 × 2 vCPU/4 GB: $48 | 5 service × 2 × 1 vCPU/2 GB: $120 |
| Broker                                                                                         |                   ไม่มี |         NATS 3 × 1 vCPU/2 GB: $36 |
| [Managed PostgreSQL](https://www.digitalocean.com/pricing/managed-databases) primary + standby |    2 vCPU/4 GB: $121.80 | cluster เดียว 4 database: $121.80 |
| รวม                                                                                            | **$169.80 ≈ 5,690 บาท** |           **$277.80 ≈ 9,310 บาท** |

ตัวเลขนี้เป็นการประมาณจากสมมติฐาน ไม่ได้วัดจริง ขนาดเครื่องเป็นการเดาสำหรับระบบ HA ขนาดเล็ก ไม่นับ load balancer กับค่า bandwidth เพราะทั้งสองแบบต้องใช้เท่ากัน และถ้าให้แต่ละ service มี database cluster ของตัวเอง ฝั่ง microservices จะขึ้นไปราว $400 (13,390 บาท) สำหรับทีมส่วนใหญ่ ต้นทุนที่หนักกว่าคือคน ทั้ง on-call ดูแล 8 container กับ broker การ trace ข้าม service และโค้ด saga เอง

## ควรเลือกแบบไหน

| ถ้าเป็นแบบนี้                                                       | เอียงไปทาง                                          |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| ทีมเดียว คนไม่ถึงราว 10 คน                                          | Modular monolith                                    |
| งานส่วนใหญ่แก้อยู่ในส่วนเดียวของระบบ                                | แบบไหนก็ได้ แต่ monolith ถูกกว่า                    |
| มีหลายทีมที่ต้อง deploy แยกกัน                                      | Microservices                                       |
| ออเดอร์หายตอนระบบล่มแพงกว่าการยืนยันช้า                             | Event-driven                                        |
| ลูกค้าต้องได้คำตอบทันทีว่าได้หรือไม่ได้ (checkout, จองตั๋ว)         | Monolith หรือ event-driven ที่มีขั้นตอน synchronous |
| มีส่วนหนึ่งที่ต้อง scale หรือพังแยกจากส่วนอื่น                      | แยกเฉพาะส่วนนั้นเป็น service                        |
| ยังไม่มี tracing ไม่มี on-call ไม่มีใครเคยดูแล broker บน production | Modular monolith                                    |

ทางสายกลางที่ตัวเลขชุดนี้สนับสนุน คือเริ่มจาก modular monolith คุมขอบเขตของ module ให้เข้ม (ห้ามเข้าไปอ่านเขียนตารางของ module อื่น) แล้วเพิ่ม outbox ให้เฉพาะ flow ที่ล่มแล้วห้ามทำออเดอร์หาย ค่อยแยก service ออกมาเมื่อมีทีมหรือความต้องการเรื่อง scale มาขอ ไม่ใช่ก่อนหน้านั้น

## ข้อจำกัด

- ทุกอย่างรันบนโน้ตบุ๊กเครื่องเดียว ฐานข้อมูล broker Node 8 process และตัวยิงโหลดแย่ง CPU กันเอง การเรียกข้าม service เป็น localhost ทำให้ตัวเลขฝั่ง microservices ดูดีกว่าความจริง เพราะ network จริงจะเพิ่ม latency ทุกทอด
- แต่ละ scenario รันรอบเดียว โดยเฉพาะ crash ผลจะแกว่งระหว่างรอบ
- monolith รันเป็น Node process เดียว ถ้ารันหลาย replica หลัง load balancer throughput จะสูงขึ้น ซึ่งก็เป็นจริงกับ microservice แต่ละตัวเหมือนกัน
- outbox relay poll ทุก 10 ms ถ้าใช้ LISTEN/NOTIFY จะลด latency ต่อทอดได้
- สองแบบใช้โค้ดร่วมกัน exercise เรื่องการแก้โค้ดจึงเข้าข้าง microservices มากกว่าการแยก repo จริง
- ตารางค่าใช้จ่ายเป็นการประมาณตามที่อธิบายไว้

เหตุผลเบื้องหลังการออกแบบ lab อยู่ใน [docs/decisions](docs/decisions)

## ร่วมพัฒนา

สิ่งที่มีประโยชน์ที่สุดคือสถาปัตยกรรมแบบใหม่ เช่น microservices ที่เรียกกันผ่าน HTTP, Kafka หรือ serverless วิธีเพิ่ม variant, scenario และ exercise อยู่ใน [CONTRIBUTING.md](CONTRIBUTING.md) ถ้าแชร์ตัวเลข ช่วยบอกสเปกเครื่องด้วย

## License

[MIT](LICENSE)

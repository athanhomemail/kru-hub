# Kru-Hub บน VPS ร่วมกับ keelek

โครงนี้เตรียมสำหรับ VPS เดิมที่มี Docker Compose และ Nginx กลางแล้ว ไม่ติดตั้งหรือแก้ keelek ระบบมีบัญชี ข้อมูลโรงเรียน ตารางสอน และแผนการสอนแล้ว ใช้ repo https://github.com/athanhomemail/kru-hub.git branch main และ domain kruhub.twiniiz.com ต้องตรวจ VPS ก่อนติดตั้งจริง

## แยกระบบ

| ระบบ | Compose project | localhost web | DB |
| --- | --- | --- | --- |
| keelek | keelek | 8081 ตามตัวอย่างเดิม | volume เดิม |
| kruhub | kruhub | 8082 (ตรวจว่าว่างก่อน) | kruhub, volume kruhub_mysql-data |

Local ใช้ mysql-twiniiz ใน group docker แต่ production ใช้ db ของ project kruhub แบบเดียวกับ keelek ไม่เชื่อมไปฐานข้อมูลของ keelek และไม่เปิดพอร์ต MySQL/API ต่อสาธารณะ

## ตรวจ VPS ก่อนติดตั้ง

รัน `sh deploy/scripts/inspect-vps.sh` บน VPS เพื่อดูทรัพยากร พอร์ต Docker projects และเฉพาะ routing ของ host Nginx สคริปต์ไม่แก้บริการ ไม่อ่าน .env และไม่แสดง environment ของ container หาก Nginx อยู่ใน container ให้ตรวจเพิ่มตามผลที่ได้ก่อนติดตั้ง ห้ามรัน start.sh จนตรวจว่าทรัพยากรและพอร์ตเพียงพอ

## เตรียมครั้งแรก

หลังตรวจ VPS และยืนยันพอร์ตว่างแล้ว clone ลงโฟลเดอร์ใหม่:

```sh
git clone --branch main https://github.com/athanhomemail/kru-hub.git /srv/apps/kruhub
cd /srv/apps/kruhub
sh deploy/scripts/init-env.sh
```

deploy/.env ใช้ FRONTEND_URL=https://kruhub.twiniiz.com และ WEB_PORT=8082 ตรวจว่าพอร์ตนี้ว่างก่อน หากเปลี่ยนพอร์ตต้องแก้ proxy_pass ในไฟล์ Nginx ของ Kru-Hub ให้ตรงกัน

สร้าง DNS ชี้ VPS และใช้ deploy/nginx/subdomain.conf.example เป็นไฟล์ใหม่สำหรับ Kru-Hub server_name ตั้งเป็น kruhub.twiniiz.com แล้ว ตรวจ port ให้ตรง .env ไฟล์นี้มี proxy headers ของตัวเอง ไม่ต้องแก้ snippet หรือ websocket map ของ Keelek ตรวจ nginx -t ก่อน reload และออกใบรับรอง domain นี้ด้วย Certbot ตามการตั้งค่า VPS เดิม ห้ามเขียนทับ server block ของ keelek หรือ config ที่ Certbot แก้ไว้แล้ว

เปิดโครงระบบ:

```sh
sh deploy/scripts/start.sh
```

สคริปต์เปิด DB รอสุขภาพดี build web/api ทำ migration สร้าง super admin (เฉพาะเมื่อไม่มีบัญชีชื่อนี้) แล้วเปิดทุก service พร้อม health checks มีหน้า login แล้ว ใช้ SUPER_ADMIN_USERNAME และรหัสจาก SUPER_ADMIN_INITIAL_PASSWORD ใน deploy/.env และเปลี่ยนรหัสเมื่อเข้าครั้งแรก ไม่สร้างโรงเรียนตัวอย่างบน VPS

ตรวจ DB/API ผ่าน:

```sh
curl --fail http://127.0.0.1:8082/api/health
sh deploy/scripts/compose.sh ps
sh deploy/scripts/compose.sh logs --tail=100 api web db
```

deploy/.env เป็น secrets ของ VPS ไม่คัดลอกจาก local และไม่เข้า Git การแก้ MYSQL_PASSWORD หลังสร้าง volume แล้วไม่เปลี่ยน password ใน MySQL ต้องหมุนรหัสใน DB ให้ตรงด้วย

## อัปเดต

เมื่อมี Git repository และ remote origin ตั้ง UPDATE_BRANCH ให้ตรง branch ที่ deploy (ค่าเริ่มต้น main):

```sh
sh deploy/scripts/update.sh
```

ตรวจ working tree สะอาด/branch ถูกต้อง ป้องกันการรัน update ซ้อน สำรอง DB ก่อน pull แบบ ff-only build ใหม่ หยุด web/api ระหว่าง migration แล้วเปิดพร้อมรอ health checks มี downtime ระหว่าง migration และเริ่ม service ใหม่

ถ้า build ล้มเหลว service เดิมยังทำงาน ถ้า migration ล้มเหลว web/api จะหยุดไว้ให้ผู้ดูแลตรวจ ห้ามเปิดโค้ดเก่ากับ schema ใหม่โดยอัตโนมัติ MySQL DDL ไม่ rollback ทั้งไฟล์ migration ได้ จึงบันทึกสถานะ running/applied พร้อม checksum และหยุดเมื่อพบ migration ค้าง ต้องวิเคราะห์/กู้คืนจาก backup ก่อนดำเนินการต่อ

หากเครื่องถูกปิดกลาง update อาจเหลือ backups/.update-lock ให้ตรวจว่าไม่มี update รันอยู่จริงก่อนลบ lock แล้วแก้ปัญหาที่ค้างไว้

## Backup / Restore

```sh
sh deploy/scripts/backup.sh
```

ได้ชุด backups/kruhub-<UTC timestamp>-<process id>.sql.gz, .uploads.tar.gz และ .sha256 รวมฐานข้อมูล migration/audit และไฟล์แผนการสอน ชุดนี้ไม่รวม deploy/.env ต้องเก็บ secrets และ backup อีกชุดนอก VPS สคริปต์ยังไม่ตั้งรอบสำรองอัตโนมัติ การ backup หยุด web/API ชั่วคราวแล้วเปิดบริการที่เคยทำงานกลับ มี downtime ทั้งตอน backup และ migration

Restore เป็นการแทนข้อมูลจริง ต้องเลือก backup ให้ถูก หยุดการเขียน และตรวจ version โค้ดให้เข้ากับ schema:

```sh
sh deploy/scripts/compose.sh stop web api
umask 077
gzip -dc backups/SELECTED.sql.gz > /tmp/kruhub-restore.sql
sh deploy/scripts/compose.sh exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot kruhub' < /tmp/kruhub-restore.sql
rm /tmp/kruhub-restore.sql
# Restore ไฟล์จากชุด timestamp เดียวกันใน volume ใหม่/ว่างที่เตรียมไว้แล้ว
# ถ้า volume เดิมไม่ว่าง ให้เก็บสำรองและเตรียมแผนแทนข้อมูลก่อน
sh deploy/scripts/compose.sh run --rm --no-deps -T api sh -c 'tar -xzf - -C /app/uploads' < backups/SELECTED.uploads.tar.gz
sh deploy/scripts/compose.sh up -d --wait
```

การ import SQL ไม่ลบตารางใหม่ที่ไม่มีใน backup หากกู้จาก release ใหม่กลับ release เก่า ต้องเตรียมฐานข้อมูลสะอาดหรือแผนลบเฉพาะตารางส่วนเกินที่ตรวจแล้วก่อน import ไม่ใช้ตัวอย่างนี้แทนแผนกู้คืนทั้งหมด

ตรวจ checksum ของชุด backup ก่อน restore (`sha256sum -c backups/SELECTED.sha256`) และใช้ SQL/ไฟล์เอกสารจากชุดเดียวกัน ห้าม down -v บน production named volume uploads ต้องคงอยู่เพื่อไม่ให้เอกสารหาย ยังไม่ได้ทดสอบ restore บน VPS จริง คู่มือนี้เป็นขั้นตอนสำหรับผู้ดูแลตรวจและทดลองในสภาพแวดล้อมทดสอบก่อน

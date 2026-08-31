#!/usr/bin/env bash
# เลื่อนเลขเวอร์ชันไฟล์หน้าเว็บทั้งชุดในคำสั่งเดียว
#
# ทำไมต้องมี: Firebase Hosting ตั้ง Cache-Control max-age=600 ให้ไฟล์ .js/.css
# ถ้า URL ไม่เปลี่ยน เบราว์เซอร์ผู้ใช้จะยังใช้ไฟล์เก่าได้อีกถึง 10 นาทีหลัง deploy
# เคยพลาดมาแล้วหลายรอบเพราะไปแก้เลขทีละที่แล้วลืมบางไฟล์ — ใช้สคริปต์นี้แทน
#
#   ./scripts/bump-version.sh          → เลื่อนขึ้น 1
#   ./scripts/bump-version.sh 50       → ตั้งเป็น 50

set -euo pipefail
cd "$(dirname "$0")/.."

CUR=$(grep -o 'VERSION = [0-9]*' public/sw.js | grep -o '[0-9]*')
NEW=${1:-$((CUR + 1))}

if [ "$NEW" = "$CUR" ]; then echo "เวอร์ชันเป็น $CUR อยู่แล้ว"; exit 0; fi

sed -i '' "s/VERSION = $CUR/VERSION = $NEW/" public/sw.js
sed -i '' "s/?v=$CUR/?v=$NEW/g" public/index.html
grep -rl "?v=$CUR" public/js | xargs sed -i '' "s/?v=$CUR/?v=$NEW/g"

# กันพลาด: ต้องไม่มี import ไฟล์ในโปรเจกต์ที่ลืมใส่ ?v=
if grep -rn "from '\./\|from '\.\./" public/js/*.js public/js/views/*.js | grep -v "?v=" ; then
  echo "❌ พบ import ที่ยังไม่ได้ใส่ ?v= ตามรายการด้านบน — ไฟล์เหล่านี้จะค้างเวอร์ชันเก่าในเบราว์เซอร์"
  exit 1
fi

for f in public/js/*.js public/js/views/*.js public/sw.js; do node --check "$f"; done

echo "✅ เลื่อนเวอร์ชัน $CUR → $NEW แล้ว ($(grep -rc "?v=$NEW" public/js public/index.html | awk -F: '{s+=$2} END {print s}') จุด) — syntax ผ่านทุกไฟล์"
echo "   ขั้นต่อไป: firebase deploy --only hosting"

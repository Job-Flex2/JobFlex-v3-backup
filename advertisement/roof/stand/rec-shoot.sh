#!/bin/bash
# The roof demo recording, one format: a fresh stand (the price-book scene writes a shop price and
# every take saves a measurement and a proposal, so every take starts from a new copy of dev.db), then the camera.
#   bash advertisement/roof/stand/rec-shoot.sh 16x9|4x5
# Needs the build: bash advertisement/roof/stand/build.sh
cd /c/Projects/JobFlex-v3-copy
export PORT=${PORT:-3511} DIST=${DIST:-.next-roofrec-prod} STAND=${STAND:-.cache/roof-rec} DBNAME=${DBNAME:-rec.db} EV_GUARD_PORT=${EV_GUARD_PORT:-3512}
export BASE=http://localhost:$PORT
# a node_modules with playwright-core (the npx playwright cache on the shoot's machine)
export NODE_PATH=${NODE_PATH:-C:/Users/ivana/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules}
for p in $PORT $EV_GUARD_PORT; do
  pid=$(netstat -ano | grep ":$p .*LISTENING" | awk '{print $NF}' | head -1)
  [ -n "$pid" ] && taskkill //PID $pid //F //T >/dev/null
done
sleep 2
DST=$STAND/$DBNAME python advertisement/roof/stand/make-db.py >/dev/null || exit 1
: > $STAND/ev-guard.log
node advertisement/roof/stand/serve.cjs >/dev/null
for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}" $BASE/auth/login 2>/dev/null | grep -q 200 && break; sleep 2; done
export MSYS_NO_PATHCONV=1
node advertisement/roof/stand/login.cjs && node advertisement/roof/record.js ${1:-16x9}
echo "orders refused by the guard this take: $(grep -c BLOCKED $STAND/ev-guard.log 2>/dev/null)"

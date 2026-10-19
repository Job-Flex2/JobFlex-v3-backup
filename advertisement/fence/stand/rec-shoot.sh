#!/bin/bash
# The fence demo recording, one format: a fresh stand (the inventory scene writes a shop rate and
# the take makes a proposal, so every take starts from a new copy of dev.db), then the camera.
#   bash advertisement/fence/stand/rec-shoot.sh 16x9|4x5
# Needs the build: bash advertisement/fence/stand/build.sh
cd /c/Projects/JobFlex-v3-copy
export PORT=${PORT:-3536} DIST=${DIST:-.next-fencerec-prod} STAND=${STAND:-.cache/fence-rec} DBNAME=${DBNAME:-rec.db}
export BASE=http://localhost:$PORT
# a node_modules with playwright-core (the npx playwright cache on the shoot's machine)
export NODE_PATH=${NODE_PATH:-C:/Users/ivana/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules}
pid=$(netstat -ano | grep ":$PORT .*LISTENING" | awk '{print $NF}' | head -1)
[ -n "$pid" ] && taskkill //PID $pid //F //T >/dev/null
sleep 2
DST=$STAND/$DBNAME python advertisement/fence/stand/make-db.py >/dev/null
node advertisement/fence/stand/serve.cjs >/dev/null
for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}" $BASE/auth/login 2>/dev/null | grep -q 200 && break; sleep 2; done
export MSYS_NO_PATHCONV=1
node advertisement/fence/stand/login.cjs && node advertisement/fence/record.js ${1:-16x9}

#!/bin/bash
# Fresh stand, then the capture: stop :3488, rebuild the db copy, start, sign in, capture.
cd /c/Projects/JobFlex-v3-copy
pid=$(netstat -ano | grep ":3488 .*LISTENING" | awk '{print $NF}' | head -1)
[ -n "$pid" ] && taskkill //PID $pid //F //T >/dev/null
sleep 2
python advertisement/hvac/stand/make-db.py
node advertisement/hvac/stand/serve.cjs
for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code}" http://localhost:3488/auth/login 2>/dev/null | grep -q 200 && break; sleep 2; done
# a node_modules with playwright-core (the npx playwright cache on the shoot's machine)
export NODE_PATH=${NODE_PATH:-/c/Users/ivana/AppData/Local/npm-cache/_npx/9833c18b2d85bc59/node_modules}
node advertisement/hvac/stand/login.cjs && node advertisement/hvac/capture.js

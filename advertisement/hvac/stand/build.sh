#!/bin/bash
# Own prod build for the HVAC film shoot; tsconfig.json put back byte-for-byte after.
cd /c/Projects/JobFlex-v3-copy
mkdir -p .cache/hvac-ad
cp tsconfig.json .cache/hvac-ad/tsconfig.before.json
node -e "const f='tsconfig.json',j=JSON.parse(require('fs').readFileSync(f,'utf8'));j.include=j.include.filter(p=>!/^\.next-/.test(p)&&!p.startsWith('.next/dev/'));require('fs').writeFileSync(f,JSON.stringify(j,null,2))"
JOBFLEX_DIST_DIR=.next-hvacad-prod NODE_ENV=production node --max-old-space-size=8192 node_modules/next/dist/bin/next build > .cache/hvac-ad/build.log 2>&1
echo "exit $?" >> .cache/hvac-ad/build.log
cp .cache/hvac-ad/tsconfig.before.json tsconfig.json

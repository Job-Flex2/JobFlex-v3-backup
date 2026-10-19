#!/bin/bash
# Own prod build for the HVAC film shoot; tsconfig.json put back byte-for-byte after.
#   DIST=.next-hvacrec-prod STAND=.cache/hvac-rec bash advertisement/hvac/stand/build.sh
cd /c/Projects/JobFlex-v3-copy
DIST=${DIST:-.next-hvacad-prod}; STAND=${STAND:-.cache/hvac-ad}
mkdir -p $STAND
cp tsconfig.json $STAND/tsconfig.before.json
node -e "const f='tsconfig.json',j=JSON.parse(require('fs').readFileSync(f,'utf8'));j.include=j.include.filter(p=>!/^\.next-/.test(p)&&!p.startsWith('.next/dev/'));require('fs').writeFileSync(f,JSON.stringify(j,null,2))"
JOBFLEX_DIST_DIR=$DIST NODE_ENV=production node --max-old-space-size=8192 node_modules/next/dist/bin/next build > $STAND/build.log 2>&1
echo "exit $?" >> $STAND/build.log
cp $STAND/tsconfig.before.json tsconfig.json

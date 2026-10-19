#!/bin/bash
# Own prod build for the roof demo recording; tsconfig.json put back byte-for-byte after.
#   bash advertisement/roof/stand/build.sh
cd /c/Projects/JobFlex-v3-copy
DIST=${DIST:-.next-roofrec-prod}; STAND=${STAND:-.cache/roof-rec}
mkdir -p $STAND
cp tsconfig.json $STAND/tsconfig.before.json
node -e "const f='tsconfig.json',j=JSON.parse(require('fs').readFileSync(f,'utf8'));j.include=j.include.filter(p=>!/^\.next-/.test(p)&&!p.startsWith('.next/dev/'));require('fs').writeFileSync(f,JSON.stringify(j,null,2))"
JOBFLEX_DIST_DIR=$DIST NODE_ENV=production node --max-old-space-size=8192 node_modules/next/dist/bin/next build > $STAND/build.log 2>&1
echo "exit $?" >> $STAND/build.log
cp $STAND/tsconfig.before.json tsconfig.json

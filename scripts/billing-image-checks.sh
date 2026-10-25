#!/usr/bin/env bash
set -euo pipefail
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --entrypoint node hemia-billing-backend:local -e '
    const fs=require("node:fs");
    for(const p of ["@nestjs/core","@hemia/auth/nestjs","@hemia/event-bus","typeorm","pg","ioredis"])require(p);
    if(process.getuid()===0 || !fs.existsSync("dist/src/main.js"))throw Error("Invalid API runtime");
    for(const p of [".env.production",".env.local","events.log.jsonl"])if(fs.existsSync(p))throw Error("Local file in runtime");
  '

container=$(docker run -d --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --memory 256m --cpus 0.5 --pids-limit 128 --init \
  --tmpfs /tmp:size=16m,mode=1777 --tmpfs /app/apps/web/.next/cache:size=32m,mode=1777 \
  -e NODE_OPTIONS=--max-old-space-size=128 hemia-billing-frontend:local)
trap 'docker rm -f "$container" >/dev/null' EXIT
for attempt in $(seq 1 15); do
  if docker exec "$container" node -e 'fetch("http://127.0.0.1:5175").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'; then
    exit 0
  fi
  sleep 1
done
docker logs "$container"
exit 1

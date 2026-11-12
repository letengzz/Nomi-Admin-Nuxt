#!/usr/bin/env bash
# 在服务器上执行的部署脚本。
#
# 由 .github/workflows/ci-cd.yml 通过 `ssh ... "bash -s"` 从 stdin 送入，
# 开头的 IMAGE / DEPLOY_PATH / APP_PORT / GHCR_TOKEN / GHCR_USER 五个变量由
# workflow 先写成 shell 赋值语句再拼到本文件前面，所以这里可以直接用。
# 也可以手动执行：先 export 这几个变量，再 bash remote-deploy.sh。

set -euo pipefail

cd "$DEPLOY_PATH"

# 私有 GHCR 包需要登录。没配 token 时说明服务器已预先 docker login，
# 或者包已设为 public，这一步自动跳过。
if [ -n "$GHCR_TOKEN" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
fi

export NOMI_IMAGE="$IMAGE"
export APP_PORT

echo "Pulling $NOMI_IMAGE ..."
docker compose -f compose.yaml pull app

# 只操作 app：nginx 在独立的 proxy profile 里，避免误停或误删已有代理容器。
docker compose -f compose.yaml up -d app

for i in $(seq 1 20); do
  if command -v curl >/dev/null 2>&1; then
    ok=$(curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1 && echo yes || echo no)
  else
    ok=$(wget -qO- "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1 && echo yes || echo no)
  fi
  if [ "$ok" = yes ]; then
    echo "Deployed $NOMI_IMAGE - health check passed."
    # 只清 24 小时前的悬空镜像，不动其他项目的层。
    docker image prune -f --filter 'until=24h' >/dev/null || true
    exit 0
  fi
  sleep 3
done

echo "Health check failed after 60s. Recent logs:" >&2
docker compose -f compose.yaml logs --tail=80 app >&2 || true
exit 1

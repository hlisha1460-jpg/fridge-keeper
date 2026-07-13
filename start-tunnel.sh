#!/bin/bash
# 冰箱管家 - 公网实时同步启动脚本
# 启动 Express 服务器 + serveo.net SSH 隧道

PORT=3000
SUBDOMAIN="fridgekeeper-lisa"

echo "🧊 冰箱管家启动中..."

# Start Express server if not already running
if ! curl -s http://localhost:$PORT/api/health > /dev/null 2>&1; then
  echo "📡 启动本地服务器..."
  cd "$(dirname "$0")"
  node server.js &
  SERVER_PID=$!
  sleep 2
  # Verify server is up
  if ! curl -s http://localhost:$PORT/api/health > /dev/null 2>&1; then
    echo "❌ 服务器启动失败！"
    exit 1
  fi
  echo "✅ 本地服务器已启动 (PID: $SERVER_PID)"
else
  echo "✅ 本地服务器已在运行"
fi

# Start serveo tunnel with fixed subdomain
echo "🌐 建立公网隧道..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔗 公网访问地址："
echo "   https://${SUBDOMAIN}.serveo.net"
echo ""
echo "📋 房间管理地址："
echo "   http://localhost:${PORT}"
echo ""
echo "⚠️  请勿关闭此窗口！按 Ctrl+C 退出"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Keep tunnel alive with auto-reconnect
while true; do
  ssh -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile=/dev/null \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R ${SUBDOMAIN}:80:localhost:${PORT} \
      serveo.net 2>&1
  echo "⚠️  隧道断开，5秒后重连..."
  sleep 5
done

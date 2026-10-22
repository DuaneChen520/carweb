// carweb-bridge Node.js 版极简网桥
// 供本地开发联调使用，行为与 bridge/main.go 保持完全一致
const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.BRIDGE_PORT || '8080', 10);
const ADB_HOST = process.env.ADB_HOST || '127.0.0.1';
const ADB_PORT = parseInt(process.env.ADB_PORT || '5037', 10);

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const socket = net.createConnection({ host: ADB_HOST, port: ADB_PORT }, () => {
      socket.end();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', bridge: true, adbHost: `${ADB_HOST}:${ADB_PORT}`, adbAlive: true }));
    });
    socket.on('error', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', bridge: true, adbHost: `${ADB_HOST}:${ADB_PORT}`, adbAlive: false }));
    });
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const urlPath = req.url || '';
  let targetHost = ADB_HOST;
  let targetPort = ADB_PORT;

  const match = urlPath.match(/^\/adb(?:\/(.+))?$/);
  if (!match) {
    ws.close(1008, 'Invalid path');
    return;
  }

  const target = match[1];
  if (target) {
    if (target.includes(':')) {
      const [h, p] = target.split(':');
      targetHost = h;
      targetPort = parseInt(p, 10) || 5037;
    } else if (/^\d+$/.test(target)) {
      targetPort = parseInt(target, 10);
    } else {
      targetHost = target;
    }
  }

  const tcp = net.createConnection({ host: targetHost, port: targetPort }, () => {
    ws.on('message', (data) => {
      tcp.write(data);
    });

    tcp.on('data', (data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    });
  });

  tcp.on('close', () => ws.close());
  tcp.on('error', (err) => {
    ws.close(1011, `TCP error: ${err.message}`);
  });

  ws.on('close', () => tcp.destroy());
  ws.on('error', () => tcp.destroy());
});

server.listen(PORT, () => {
  console.log(`[carweb-bridge] 网桥已启动，监听 :${PORT}，目标 ADB 宿主 ${ADB_HOST}:${ADB_PORT}`);
});

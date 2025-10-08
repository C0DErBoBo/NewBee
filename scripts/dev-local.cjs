#!/usr/bin/env node
/*
 * 本地一键开发脚本：
 * - 启动（或复用）Docker Postgres 容器
 * - 等待数据库就绪
 * - 设置 DATABASE_URL 并并行启动 backend + frontend
 *
 * 依赖：Docker CLI、Node.js 18+、pnpm 8+
 */

/* eslint-disable no-console */
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');

const CONTAINER_NAME = 'pg-competition';
const IMAGE = 'postgres:15';
const DB_NAME = 'competition_system';
const DB_USER = 'postgres';
const DB_PASS = 'postgres';

function runSync(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', ...opts });
  return {
    status: res.status,
    stdout: res.stdout ? res.stdout.toString().trim() : '',
    stderr: res.stderr ? res.stderr.toString().trim() : ''
  };
}

function isCommandAvailable(command) {
  const r = runSync(command, ['--version']);
  return r.status === 0;
}

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

async function ensurePostgres() {
  if (!isCommandAvailable('docker')) {
    console.error('未检测到 Docker，请先安装并运行 Docker Desktop。');
    process.exit(1);
  }

  console.log('检查本地 Postgres 容器...');
  const exists = runSync('docker', ['ps', '-a', '--filter', `name=${CONTAINER_NAME}`, '--format', '{{.ID}}']).stdout;
  let hostPort = 5432;

  if (!exists) {
    // 新建容器，选择空闲端口；若 5432 被占用且未检测到，则在失败后回退到 5433
    const port5432Free = await isPortFree(5432);
    hostPort = port5432Free ? 5432 : 5433;

    const runContainer = (port) => runSync('docker', [
      'run', '--name', CONTAINER_NAME,
      '-e', `POSTGRES_PASSWORD=${DB_PASS}`,
      '-e', `POSTGRES_DB=${DB_NAME}`,
      '-p', `${port}:5432`,
      '-d', IMAGE
    ]);

    console.log(`创建容器 ${CONTAINER_NAME}（映射端口 ${hostPort}->5432）...`);
    let res = runContainer(hostPort);
    if (res.status !== 0 && /port is already allocated/i.test(res.stderr + res.stdout)) {
      // 自动回退到 5433
      if (hostPort !== 5433) {
        console.log('5432 已占用，尝试改用宿主端口 5433...');
        hostPort = 5433;
        res = runContainer(hostPort);
      }
    }

    if (res.status !== 0) {
      console.error('创建容器失败:', res.stderr || res.stdout);
      process.exit(1);
    }
  } else {
    // 容器存在，确保运行，并解析端口
    const running = runSync('docker', ['ps', '--filter', `name=${CONTAINER_NAME}`, '--format', '{{.ID}}']).stdout;
    if (!running) {
      console.log(`启动容器 ${CONTAINER_NAME} ...`);
      const startRes = runSync('docker', ['start', CONTAINER_NAME]);
      if (startRes.status !== 0) {
        const msg = (startRes.stderr || startRes.stdout || '').toString();
        if (/port is already allocated/i.test(msg)) {
          console.warn('检测到 5432 端口冲突，将重建容器并改用宿主端口 5433...');
          // 清除旧容器并用 5433 重建
          runSync('docker', ['rm', '-f', CONTAINER_NAME]);
          hostPort = 5433;
          const res2 = runSync('docker', [
            'run', '--name', CONTAINER_NAME,
            '-e', `POSTGRES_PASSWORD=${DB_PASS}`,
            '-e', `POSTGRES_DB=${DB_NAME}`,
            '-p', `${hostPort}:5432`,
            '-d', IMAGE
          ]);
          if (res2.status !== 0) {
            console.error('重建容器失败:', res2.stderr || res2.stdout);
            process.exit(1);
          }
        } else {
          console.error('启动容器失败:', msg);
          process.exit(1);
        }
      }
    }
    const portInfo = runSync('docker', ['port', CONTAINER_NAME, '5432/tcp']).stdout; // 例如 0.0.0.0:5432
    const match = portInfo.match(/:(\d+)/);
    if (match) hostPort = Number(match[1]);
  }

  // 等待数据库就绪
  console.log('等待 Postgres 就绪...');
  const deadline = Date.now() + 30_000;
  // 使用 pg_isready 检测
  while (Date.now() < deadline) {
    const ready = runSync('docker', ['exec', CONTAINER_NAME, 'pg_isready', '-U', DB_USER, '-d', DB_NAME]);
    if (ready.status === 0 && /accepting connections/i.test(ready.stdout)) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log('Postgres 已就绪。');
  const url = `postgres://${DB_USER}:${DB_PASS}@127.0.0.1:${hostPort}/${DB_NAME}`;
  return { hostPort, url };
}

async function main() {
  try {
    const arg = (process.argv[2] || 'up').toLowerCase();
    if (arg === 'down' || arg === '--down') {
      console.log('停止并移除本地 Postgres 容器...');
      runSync('docker', ['rm', '-f', CONTAINER_NAME]);
      console.log('已清理。');
      process.exit(0);
    }

    const { url, hostPort } = await ensurePostgres();
    console.log(`DATABASE_URL: ${url}`);

    if (arg === 'db' || arg === '--db' || arg === 'status' || arg === '--status') {
      console.log(`DB 状态：容器 ${CONTAINER_NAME} 运行中，端口映射 ${hostPort}->5432`);
      process.exit(0);
    }

    console.log('并行启动 backend 与 frontend ...');

    const env = { ...process.env, DATABASE_URL: url };
    // 使用根脚本 `pnpm dev` 并传递环境变量给 backend
    const child = spawn('pnpm', ['dev'], {
      env,
      stdio: 'inherit',
      shell: true
    });

    child.on('exit', (code) => {
      console.log(`开发进程退出，代码 ${code}`);
      process.exit(code ?? 0);
    });

    const handleSignal = (sig) => {
      console.log(`收到信号 ${sig}，正在退出...`);
      child.kill(sig);
    };
    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

    console.log(`前端开发地址： http://localhost:5173/`);
    console.log(`后端 API 地址： http://127.0.0.1:4000/api （DB 端口映射：${hostPort}）`);
  } catch (err) {
    console.error('启动失败：', err);
    process.exit(1);
  }
}

main();

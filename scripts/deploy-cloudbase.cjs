#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_PATH =
  process.env.CLOUDBASE_DEPLOY_CONFIG ||
  path.resolve(process.cwd(), 'deploy.config.json');

function logFactory(stream) {
  return function log(message) {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    stream.write(`${line}\n`);
  };
}

function ensureConfigExists(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`未找到部署配置文件：${configPath}`);
  }
}

function loadConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`解析部署配置失败：${error.message}`);
  }
}

function parseCommand(input) {
  if (!input) {
    return [];
  }
  if (typeof input !== 'string') {
    throw new Error(`无法解析命令：${input}`);
  }
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '\\' && i + 1 < input.length) {
      current += input[++i];
      continue;
    }
    if ((char === '"' || char === "'")) {
      if (!quote) {
        quote = char;
        continue;
      }
      if (quote === char) {
        quote = null;
        continue;
      }
    }
    if (!quote && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  if (quote) {
    throw new Error(`命令存在未闭合引号：${input}`);
  }
  return tokens;
}

function normalizeArgs(input) {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input.flatMap((item) => normalizeArgs(item));
  }
  return parseCommand(input);
}

function execCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell: false
  });
  return result;
}

function runCommand(log, command, args, options = {}) {
  log(`开始执行命令：${command} ${args.join(' ')}`);
  const result = execCommand(command, args, options);

  if (result.stdout) {
    log(result.stdout.trim());
  }
  if (result.stderr) {
    log(result.stderr.trim());
  }
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`命令执行失败（退出码 ${result.status}）：${command}`);
  }
  log(`命令执行完成：${command}`);
  return result;
}

function probeCli(log) {
  const candidates = (process.env.CLOUDBASE_CLI || 'cloudbase,tcb')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  for (const cli of candidates) {
    const result = spawnSync(cli, ['-V'], { encoding: 'utf8', shell: false });
    if (!result.error && (result.status === 0 || result.status === null)) {
      log(`检测到 CloudBase CLI：${cli}`);
      return cli;
    }
  }

  throw new Error(
    '未检测到 CloudBase CLI，请安装 cloudbase-cli 并配置到 PATH。'
  );
}

function normalizeCommands(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return [];
  }
  return list.map((item) => normalizeArgs(item));
}

function resolveProjectPath(projectPath) {
  return path.resolve(process.cwd(), projectPath || '.');
}

function runPipeline() {
  ensureConfigExists(CONFIG_PATH);

  const config = loadConfig(CONFIG_PATH);
  const projectRoot = resolveProjectPath(config.projectPath);
  const logDir = path.resolve(projectRoot, 'deployment-logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(
    logDir,
    `deploy-${new Date().toISOString().replace(/[:]/g, '-')}.log`
  );
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });
  const log = logFactory(logStream);

  log(`部署配置文件：${CONFIG_PATH}`);
  log(`项目根目录：${projectRoot}`);

  if (!config.cloudbaseEnvId) {
    throw new Error('部署配置缺少 cloudbaseEnvId。');
  }

  const env = { ...process.env };
  let cli = null;

  try {
    cli = probeCli(log);

    normalizeCommands(config.preDeployCommands).forEach((commandArgs) => {
      if (commandArgs.length === 0) {
        return;
      }
      const [command, ...args] = commandArgs;
      runCommand(log, command, args, { cwd: projectRoot, env });
    });

    if (config.buildCommand) {
      const buildArgs = parseCommand(config.buildCommand);
      if (buildArgs.length > 0) {
        const [command, ...args] = buildArgs;
        runCommand(log, command, args, { cwd: projectRoot, env });
      } else {
        log('buildCommand 已配置但解析结果为空，跳过构建。');
      }
    } else {
      log('未配置 buildCommand，跳过构建步骤。');
    }

    const deployArgs = normalizeArgs(
      config.deployCommand || 'framework:deploy'
    );
    if (deployArgs.length === 0) {
      throw new Error('deployCommand 解析失败，无法执行部署。');
    }

    const extraDeployArgs = normalizeArgs(config.deployArgs || []);
    const fullDeployArgs = [
      ...deployArgs,
      ...extraDeployArgs,
      '--envId',
      config.cloudbaseEnvId
    ];

    if (config.cloudbaseRegion) {
      fullDeployArgs.push('--region', config.cloudbaseRegion);
    }
    if (
      config.outputDirectory &&
      deployArgs[0] &&
      deployArgs[0].includes('hosting:deploy') &&
      !fullDeployArgs.includes(config.outputDirectory)
    ) {
      fullDeployArgs.push(
        path.resolve(projectRoot, config.outputDirectory)
      );
    }

    runCommand(log, cli, fullDeployArgs, { cwd: projectRoot, env });

    normalizeCommands(config.postDeployCommands).forEach((commandArgs) => {
      if (commandArgs.length === 0) {
        return;
      }
      const [command, ...args] = commandArgs;
      runCommand(log, command, args, { cwd: projectRoot, env });
    });


    log('部署流程执行完成。');
    log(`日志输出：${path.relative(projectRoot, logFile)}`);
    logStream.end();
  } catch (error) {
    log(`部署流程失败：${error.message}`);
    if (cli && config.rollback && config.rollback.enabled) {
      try {
        const rollbackArgs = normalizeArgs(
          config.rollback.command || 'framework:deploy'
        );
        if (rollbackArgs.length === 0) {
          throw new Error('rollback.command 解析失败。');
        }
        const rollbackExtra = normalizeArgs(
          config.rollback.arguments || config.rollback.args || []
        );
        const fullRollbackArgs = [
          ...rollbackArgs,
          ...rollbackExtra,
          '--envId',
          config.cloudbaseEnvId
        ];
        if (config.cloudbaseRegion) {
          fullRollbackArgs.push('--region', config.cloudbaseRegion);
        }
        log('尝试执行自动回滚...');
        runCommand(log, cli, fullRollbackArgs, { cwd: projectRoot, env });
        log('回滚执行完成。');
      } catch (rollbackError) {
        log(`回滚失败：${rollbackError.message}`);
      }
    } else {
      log('未启用自动回滚，跳过回滚步骤。');
    }
    log(`部署日志保存在：${path.relative(projectRoot, logFile)}`);
    logStream.end();
    process.exitCode = 1;
  }
}

runPipeline();

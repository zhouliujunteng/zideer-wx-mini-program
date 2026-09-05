#!/usr/bin/env node

import { spawn } from 'node:child_process';

const [toolName, rawArguments = '{}'] = process.argv.slice(2);

if (!toolName) {
  throw new Error('Usage: node wechat-mcp-call.mjs <tool-name> <json-arguments>');
}

let toolArguments;
try {
  toolArguments = JSON.parse(rawArguments);
} catch {
  throw new Error('The tool arguments must be valid JSON.');
}

const bridge = spawn('wechatide', ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
let finished = false;
let timeoutId;

function redact(value) {
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
      .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g, '[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      /ticket|token|secret|authorization|cookie/i.test(key) ? '[REDACTED]' : redact(child),
    ]),
  );
}

function send(message) {
  bridge.stdin.write(`${JSON.stringify(message)}\n`);
}

function finish(exitCode, payload) {
  if (finished) return;
  finished = true;
  clearTimeout(timeoutId);
  console.log(JSON.stringify(redact(payload), null, 2));
  bridge.kill();
  process.exitCode = exitCode;
}

bridge.stdout.on('data', (chunk) => {
  buffer += chunk;

  while (true) {
    const lineEnd = buffer.indexOf('\n');
    if (lineEnd === -1) return;

    const line = buffer.slice(0, lineEnd).trim();
    buffer = buffer.slice(lineEnd + 1);
    if (!line) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    if (message.id === 1) {
      send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: toolName, arguments: toolArguments },
      });
    } else if (message.id === 2) {
      finish(message.error ? 1 : 0, message.error || message.result);
    }
  }
});

bridge.stderr.on('data', () => {});
bridge.on('error', (error) => finish(1, { error: error.message }));

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'zhilu-p2d-verification', version: '1.0.0' },
  },
});

timeoutId = setTimeout(
  () => finish(1, { error: 'The WeChat DevTools MCP call timed out.' }),
  30_000,
);

import { afterEach, describe, expect, test } from 'bun:test';
import { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { createLabApi } from './labApi.js';
import { ThingRegistry } from '../things/ThingRegistry.js';

// The tasks route never touches the registry, so none is needed.
const handle = createLabApi({} as ThingRegistry);

async function get(path: string, remoteAddress: string): Promise<{ status: number; body: { tasks?: unknown[] } }> {
  const req = { method: 'GET', socket: { remoteAddress } } as unknown as IncomingMessage;
  let status = 0;
  let body = '';
  const res = {
    writeHead(code: number) { status = code; },
    end(chunk: string) { body = chunk; }
  } as unknown as ServerResponse;
  const url = new URL(path, 'http://localhost:8081');
  await handle(req, res, url.pathname.split('/').filter(Boolean).slice(1), url);
  return { status, body: JSON.parse(body) };
}

describe('GET /_lab/environments/{name}/tasks', () => {
  const saved = process.env.WOT_LAB_ALLOW_REMOTE_WRITE;
  afterEach(() => {
    if (saved === undefined) {
      delete process.env.WOT_LAB_ALLOW_REMOTE_WRITE;
    } else {
      process.env.WOT_LAB_ALLOW_REMOTE_WRITE = saved;
    }
  });

  test('is refused from another machine', async () => {
    delete process.env.WOT_LAB_ALLOW_REMOTE_WRITE;
    const { status, body } = await get('/_lab/environments/smart-home/tasks', '192.168.1.20');
    expect(status).toBe(403);
    expect(body.tasks).toBeUndefined();
  });

  test.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('is served to loopback %s', async address => {
    delete process.env.WOT_LAB_ALLOW_REMOTE_WRITE;
    const { status, body } = await get('/_lab/environments/smart-home/tasks', address);
    expect(status).toBe(200);
    expect(body.tasks?.length).toBeGreaterThan(0);
  });

  test('is served to another machine with WOT_LAB_ALLOW_REMOTE_WRITE=1', async () => {
    process.env.WOT_LAB_ALLOW_REMOTE_WRITE = '1';
    const { status } = await get('/_lab/environments/smart-home/tasks', '192.168.1.20');
    expect(status).toBe(200);
  });
});

// electron/obs-client.test.ts — covers the auto-reconnect behavior added
// 2026-11-01 (see obs-client.ts's own header comment on lastUrl/
// explicitlyDisconnected/wasConnected/reconnectTimer): a connection that
// drops AFTER succeeding should retry in the background; an explicit
// disconnectObs() call, or a connection that never succeeded in the first
// place, should not. obs-client.ts has no Electron-API dependency of its
// own, so only its one real external dependency (obs-websocket-js) needs
// mocking — everything else here runs as plain Node.
//
// Real timers, not fake ones — scheduleReconnect's setTimeout races against
// a real dynamic `import('obs-websocket-js')` on every attempt, and under
// Vite's SSR module loader (even mocked) that crosses a genuine async
// boundary fake timers' microtask-flushing can't fast-forward through.
// Waits below use the real delay plus a buffer margin instead.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  class FakeOBS {
    listeners: Record<string, Array<(data?: unknown) => void>> = {};
    on(event: string, cb: (data?: unknown) => void): void {
      (this.listeners[event] ||= []).push(cb);
    }
    emit(event: string, data?: unknown): void {
      (this.listeners[event] || []).forEach((cb) => cb(data));
    }
    connect(): Promise<void> {
      return mocks.connectImpl();
    }
    disconnect(): Promise<void> {
      return Promise.resolve();
    }
    call(method: string): Promise<unknown> {
      if (method === 'GetSceneList') return Promise.resolve({ scenes: [], currentProgramSceneName: null });
      return Promise.resolve({ outputActive: false, outputDuration: 0 });
    }
  }
  return {
    instances: [] as FakeOBS[],
    // Reassigned per-test to control whether the NEXT connect() attempt
    // succeeds or fails — connect() above always calls through this
    // indirection so a single test can simulate "OBS just isn't up yet,
    // then comes back."
    connectImpl: (): Promise<void> => Promise.resolve(),
    FakeOBS,
  };
});

vi.mock('obs-websocket-js', () => ({
  default: class {
    constructor() {
      const inst = new mocks.FakeOBS();
      mocks.instances.push(inst);
      return inst as unknown as InstanceType<typeof mocks.FakeOBS>;
    }
  },
}));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('obs-client auto-reconnect', () => {
  let obsClient: typeof import('./obs-client');

  beforeEach(async () => {
    vi.resetModules();
    mocks.instances.length = 0;
    mocks.connectImpl = () => Promise.resolve();
    obsClient = await import('./obs-client');
  });

  it('reconnects automatically after a connection that had succeeded drops', async () => {
    await obsClient.connectObs('ws://127.0.0.1:4455', '');
    expect(obsClient.getObsStatus().connected).toBe(true);
    expect(mocks.instances).toHaveLength(1);

    // Simulate OBS crashing/restarting mid-stream.
    mocks.instances[0].emit('ConnectionClosed');
    expect(obsClient.getObsStatus().connected).toBe(false);

    await sleep(3300); // scheduleReconnect's default delay (3000ms) + buffer

    expect(mocks.instances).toHaveLength(2); // a reconnect attempt actually fired
    expect(obsClient.getObsStatus().connected).toBe(true); // and it succeeded
  }, 10_000);

  it('keeps retrying with backoff if OBS is still down, then recovers once it is back', async () => {
    await obsClient.connectObs('ws://127.0.0.1:4455', '');
    mocks.instances[0].emit('ConnectionClosed');

    mocks.connectImpl = () => Promise.reject(new Error('OBS not reachable'));
    await sleep(3300); // 1st retry (~3000ms) — fails
    expect(mocks.instances).toHaveLength(2);
    expect(obsClient.getObsStatus().connected).toBe(false);

    mocks.connectImpl = () => Promise.resolve();
    await sleep(6500); // 2nd retry (backed off to ~6000ms) — succeeds
    expect(mocks.instances).toHaveLength(3);
    expect(obsClient.getObsStatus().connected).toBe(true);
  }, 15_000);

  it('does not auto-reconnect after an explicit disconnectObs() call', async () => {
    await obsClient.connectObs('ws://127.0.0.1:4455', '');
    await obsClient.disconnectObs();
    mocks.instances[0].emit('ConnectionClosed'); // a late/straggling event from the old client

    await sleep(3300); // well past when a reconnect would have fired, if one had been scheduled

    expect(mocks.instances).toHaveLength(1); // no reconnect attempt was ever made
    expect(obsClient.getObsStatus().connected).toBe(false);
  }, 10_000);

  it('does not loop forever if the very first connect attempt fails', async () => {
    mocks.connectImpl = () => Promise.reject(new Error('bad url'));
    await expect(obsClient.connectObs('ws://127.0.0.1:9999', '')).rejects.toThrow();

    await sleep(3300);

    expect(mocks.instances).toHaveLength(1); // never having connected, there's nothing to silently retry
  }, 10_000);
});

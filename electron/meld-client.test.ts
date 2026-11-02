// electron/meld-client.test.ts — same auto-reconnect coverage as
// obs-client.test.ts, for Meld Studio's own connection (added 2026-11-01,
// identical shape: lastUrl/explicitlyDisconnected/wasConnected/
// reconnectTimer — see meld-client.ts's own header). Mocks the two real
// external dependencies (`ws`'s WebSocket, and `qwebchannel`'s QWebChannel)
// rather than running against a real socket or a real Meld Studio instance.
//
// Real timers, not fake ones — see obs-client.test.ts's own header for why
// (scheduleReconnect races a real dynamic import/module load that fake
// timers can't fast-forward through).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  class FakeWS {
    onopen: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(public url: string) {
      mocks.sockets.push(this);
      // Mirrors a real WebSocket: open/error arrive asynchronously, never
      // synchronously inside the constructor.
      queueMicrotask(() => {
        if (mocks.openShouldFail) this.onerror?.(new Error('refused'));
        else this.onopen?.();
      });
    }
    close(): void {}
  }

  function makeMeldObject() {
    return {
      session: { items: {} },
      isStreaming: false,
      isRecording: false,
      sessionChanged: { connect: () => {} },
      isStreamingChanged: { connect: () => {} },
      isRecordingChanged: { connect: () => {} },
    };
  }

  class FakeQWebChannel {
    constructor(_socket: FakeWS, callback: (channel: { objects: Record<string, unknown> }) => void) {
      callback({ objects: mocks.exposeNoMeldObject ? {} : { meld: makeMeldObject() } });
    }
  }

  return {
    sockets: [] as FakeWS[],
    openShouldFail: false,
    exposeNoMeldObject: false,
    FakeWS,
    FakeQWebChannel,
  };
});

vi.mock('ws', () => ({ default: mocks.FakeWS }));
// meld-client.ts loads this via `(await import('qwebchannel')).default` —
// matching the real CJS package's shape, where `.default` is its whole
// `module.exports` object.
vi.mock('qwebchannel', () => ({ default: { QWebChannel: mocks.FakeQWebChannel } }));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('meld-client auto-reconnect', () => {
  let meldClient: typeof import('./meld-client');

  beforeEach(async () => {
    vi.resetModules();
    mocks.sockets.length = 0;
    mocks.openShouldFail = false;
    mocks.exposeNoMeldObject = false;
    meldClient = await import('./meld-client');
  });

  it('reconnects automatically after a connection that had succeeded drops', async () => {
    await meldClient.connectMeld('ws://127.0.0.1:13376');
    expect(meldClient.getMeldStatus().connected).toBe(true);
    expect(mocks.sockets).toHaveLength(1);

    // Simulate Meld Studio closing/restarting mid-stream.
    mocks.sockets[0].onclose?.();
    expect(meldClient.getMeldStatus().connected).toBe(false);

    await sleep(3300); // scheduleReconnect's default delay (3000ms) + buffer

    expect(mocks.sockets).toHaveLength(2); // a reconnect attempt actually fired
    expect(meldClient.getMeldStatus().connected).toBe(true); // and it succeeded
  }, 10_000);

  it('does not auto-reconnect after an explicit disconnectMeld() call', async () => {
    await meldClient.connectMeld('ws://127.0.0.1:13376');
    await meldClient.disconnectMeld();
    mocks.sockets[0].onclose?.(); // a late/straggling event from the old socket

    await sleep(3300); // well past when a reconnect would have fired, if one had been scheduled

    expect(mocks.sockets).toHaveLength(1); // no reconnect attempt was ever made
    expect(meldClient.getMeldStatus().connected).toBe(false);
  }, 10_000);

  it('does not loop forever if the very first connect attempt fails', async () => {
    mocks.openShouldFail = true;
    await expect(meldClient.connectMeld('ws://127.0.0.1:13376')).rejects.toThrow();

    await sleep(3300);

    expect(mocks.sockets).toHaveLength(1); // never having connected, there's nothing to silently retry
  }, 10_000);
});

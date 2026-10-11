// Probes the playground server (ws://127.0.0.1:1234) and simulates an upstream commit. See playground.ts.
import { SERVER, type Mode, type ServerKind } from './playground';

export interface ServerStatus {
  text: string;
  /** A command to run, shown as code. */
  hint?: string;
  level: 'info' | 'ok' | 'warn';
}

/** What a simulated upstream commit changes (see server/src/playground/playground.ts). */
export type UpstreamChange = 'append' | 'heading';

/**
 * What the bar shows about the server: `checking` until the first answer,
 * `reload` when it came up after the page fell back to a local copy, `lost`
 * when it went away after the page joined its room.
 */
export type ServerState = ServerKind | 'checking' | 'reload' | 'lost';

/**
 * Asks the playground server whether it is there, and whether it has the fake
 * GitLab (`GET /playground`). A server without that endpoint (e.g. `mise run
 * server:dev`) sends no CORS header there, so a second, opaque request
 * tells it apart from a closed port.
 */
export async function probeServer(fetchFn: typeof fetch = fetch): Promise<ServerKind> {
  try {
    const response = await fetchFn(`${SERVER.http}/playground`);
    if (response.ok) return 'gitlab';
  } catch {
    // no CORS answer: no playground endpoints, or nothing listening
  }
  try {
    await fetchFn(`${SERVER.http}/`, { mode: 'no-cors' });
    return 'plain';
  } catch {
    return 'offline';
  }
}

/** Has the fake GitLab commit a change to the room's branch, as a colleague pushing would. Resolves with a line for the bar. */
export async function simulateUpstream(room: string, change: UpstreamChange, fetchFn: typeof fetch = fetch): Promise<string> {
  const query = new URLSearchParams({ room, change });
  const response = await fetchFn(`${SERVER.http}/playground/upstream?${query}`, { method: 'POST' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const commit = (await response.json()) as { sha: string; path: string; message: string };
  return `GitLab: ${commit.sha.slice(0, 8)} “${commit.message}” changed ${commit.path}`;
}

/** What the bar says about the server in `mode` (`null`: Local mode, which does not ask). */
export function describeServer(mode: Mode, state: ServerState | null): ServerStatus {
  if (mode === 'local' || state === null) return { level: 'info', text: 'Local: everything runs in this tab, no server needed.' };
  return STATUS[state](mode);
}

const STATUS: Record<ServerState, (mode: Mode) => ServerStatus> = {
  checking: () => ({ level: 'info', text: `Connecting to ${SERVER.ws}…` }),
  offline: () => ({ level: 'warn', text: `Server not reachable at ${SERVER.ws}; editing a local copy. Start it, then reload:`, hint: START }),
  lost: () => ({ level: 'warn', text: `Lost ${SERVER.ws}; edits sync again once it is back. Restart it:`, hint: START }),
  reload: () => ({ level: 'warn', text: 'The server is up now: reload the page to join the room.' }),
  plain: (mode) => (mode === 'gitlab' ? MISSING_GITLAB : CONNECTED),
  gitlab: (mode) => (mode === 'gitlab' ? { level: 'ok', text: 'Connected to the fake GitLab (project demo/report).' } : CONNECTED),
};

const START = 'mise run demo';

const MISSING_GITLAB: ServerStatus = {
  level: 'warn',
  text: `${SERVER.ws} has no fake GitLab (mise run server:dev?). Start the playground server instead:`,
  hint: START,
};

const CONNECTED: ServerStatus = { level: 'ok', text: `Connected to ${SERVER.ws}.` };

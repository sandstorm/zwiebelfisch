// Probes the playground server (ws://127.0.0.1:1234) and simulates an upstream commit. See main.ts.
import { SERVER, type Mode, type ServerKind } from './playground';

export interface ServerStatus {
  text: string;
  /** A command to run, shown as code. */
  hint?: string;
  level: 'info' | 'ok' | 'warn';
}

/** What a simulated upstream commit changes (see server/lib/playground). */
export type UpstreamChange = 'append' | 'heading';

/** What the probe found: which server, and whether it opens plain rooms (Collaborate mode). */
export interface ServerProbe {
  kind: ServerKind;
  plainRooms: boolean;
}

/**
 * What the bar shows about the server: `checking` until the first answer,
 * `reload` when it came up after the page fell back to a local copy, `lost`
 * when it went away after the page joined its room.
 */
export type ServerState = ServerKind | 'checking' | 'reload' | 'lost';

/**
 * Asks the server what it offers (`GET /api/public/info`: plain rooms or not) and whether it is the playground server
 * with the fake GitLab (`GET /playground`). A server without that endpoint (e.g. `mise run server:dev`) sends no
 * CORS header there, so its request fails.
 */
export async function probeServer(fetchFn: typeof fetch = fetch): Promise<ServerProbe> {
  let plainRooms: boolean;
  try {
    const response = await fetchFn(`${SERVER.http}/api/public/info`);
    plainRooms = response.ok && ((await response.json()) as { plainRooms?: unknown }).plainRooms === true;
  } catch {
    return { kind: 'offline', plainRooms: false };
  }
  try {
    const response = await fetchFn(`${SERVER.http}/playground`);
    if (response.ok) return { kind: 'gitlab', plainRooms };
  } catch {
    // no CORS answer: no playground endpoints
  }
  return { kind: 'server', plainRooms };
}

/** Has the fake GitLab commit a change to the room's branch, as a colleague pushing would. Resolves with a line for the bar. */
export async function simulateUpstream(room: string, change: UpstreamChange, fetchFn: typeof fetch = fetch): Promise<string> {
  const query = new URLSearchParams({ room, change });
  const response = await fetchFn(`${SERVER.http}/playground/upstream?${query}`, { method: 'POST' });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  const commit = (await response.json()) as { sha: string; path: string; message: string };
  return `GitLab: ${commit.sha.slice(0, 8)} “${commit.message}” changed ${commit.path}`;
}

/**
 * What the bar says about the server in `mode` (`null`: Local mode, which does not ask); `plainRooms`: whether it
 * opens plain rooms (Collaborate mode).
 */
export function describeServer(mode: Mode, state: ServerState | null, plainRooms = true): ServerStatus {
  if (mode === 'local' || state === null) return { level: 'info', text: 'Local: everything runs in this tab, no server needed.' };
  if (mode === 'collab' && !plainRooms && (state === 'gitlab' || state === 'server')) return NO_PLAIN_ROOMS;
  return STATUS[state](mode);
}

const STATUS: Record<ServerState, (mode: Mode) => ServerStatus> = {
  checking: () => ({ level: 'info', text: `Connecting to ${SERVER.ws}…` }),
  offline: () => ({ level: 'warn', text: `Server not reachable at ${SERVER.ws}; editing a local copy. Start it, then reload:`, hint: START }),
  lost: () => ({ level: 'warn', text: `Lost ${SERVER.ws}; edits sync again once it is back. Restart it:`, hint: START }),
  reload: () => ({ level: 'warn', text: 'The server is up now: reload the page to join the room.' }),
  server: (mode) => (mode === 'gitlab' ? MISSING_GITLAB : CONNECTED),
  gitlab: (mode) => (mode === 'gitlab' ? { level: 'ok', text: 'Connected to the fake GitLab (project demo/report).' } : CONNECTED),
};

const START = 'mise run demo';

const MISSING_GITLAB: ServerStatus = {
  level: 'warn',
  text: `${SERVER.ws} has no fake GitLab (mise run server:dev?). Start the playground server instead:`,
  hint: START,
};

const NO_PLAIN_ROOMS: ServerStatus = {
  level: 'warn',
  text: `${SERVER.ws} opens only GitLab rooms (plain rooms are off: ZWF_PLAIN_ROOMS). Use GitLab mode, or start the playground server:`,
  hint: START,
};

const CONNECTED: ServerStatus = { level: 'ok', text: `Connected to ${SERVER.ws}.` };

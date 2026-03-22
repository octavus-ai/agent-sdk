import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { platform } from 'node:os';
import { existsSync } from 'node:fs';

export interface ChromeInstance {
  port: number;
  process: ChildProcess;
  pid: number;
}

export interface ChromeLaunchOptions {
  profileDir: string;
  debuggingPort?: number;
  flags?: string[];
}

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium'],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

function findChromePath(): string {
  const os = platform();
  const candidates = CHROME_PATHS[os] ?? CHROME_PATHS.linux!;

  for (const candidate of candidates) {
    const isAbsolute = candidate.startsWith('/') || candidate.startsWith('C:\\');
    if (isAbsolute) {
      if (existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }

  throw new Error(
    `Chrome not found. Searched: ${candidates.join(', ')}. ` +
      'Install Google Chrome or set the path explicitly.',
  );
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address !== null && typeof address === 'object') {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to allocate port')));
      }
    });
    server.on('error', reject);
  });
}

function waitForDebuggingPort(port: number, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Chrome debugging port ${port} not ready after ${timeoutMs}ms`));
        return;
      }

      fetch(`http://127.0.0.1:${port}/json/version`)
        .then((res) => {
          if (res.ok) resolve();
          else setTimeout(attempt, 200);
        })
        .catch(() => {
          setTimeout(attempt, 200);
        });
    }
    attempt();
  });
}

export async function launchChrome(options: ChromeLaunchOptions): Promise<ChromeInstance> {
  const chromePath = findChromePath();
  const port = options.debuggingPort ?? (await findFreePort());

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${options.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    ...(options.flags ?? []),
  ];

  const child = spawn(chromePath, args, {
    stdio: 'ignore',
    detached: false,
  });

  if (child.pid === undefined) {
    throw new Error(`Failed to launch Chrome at ${chromePath}`);
  }

  child.on('error', () => {
    // Chrome process errors are handled by the caller via the process reference
  });

  await waitForDebuggingPort(port);

  return { port, process: child, pid: child.pid };
}

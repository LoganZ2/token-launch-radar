// Token Launch Radar entrypoint (Node 22, standard library only).
// Reads /input/snapshot.json, calibrates the econometric model on clean traded peers,
// writes /output/board.json, /output/data.js, copies dashboard/ and screenshots/, and
// seals /output/dossier.json via vendor/makefun-board.ts.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './dashboard/model.js';
import { buildDossier } from './vendor/makefun-board.ts';

const { buildRadar, parseSnapshot, validateBoard } = (globalThis as Record<string, any>).TokenRadarModel;

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_MAX = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASH_CAPS = { max_files: 400, max_bytes: 4_194_304 };

function cliArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${flag}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]!;
  const prefix = `--${flag}=`;
  const eq = process.argv.find((a) => a.startsWith(prefix));
  return eq ? eq.slice(prefix.length) : fallback;
}

function copyFlatDir(srcDir: string, dstDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  mkdirSync(dstDir, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(srcDir).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(srcDir, name);
    if (!statSync(full).isFile()) continue;
    copyFileSync(full, join(dstDir, name));
    copied.push(name);
  }
  return copied;
}

function main(): void {
  const rawInput = cliArg('input', '/input');
  const snapshotPath = rawInput.endsWith('.json') ? rawInput : join(rawInput, 'snapshot.json');
  if (!existsSync(snapshotPath)) {
    throw new Error(`Snapshot file not found at ${snapshotPath}`);
  }
  const outputDir = cliArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
  const { board, payload } = buildRadar(snapshot);
  const problem = validateBoard(board, snapshot);
  if (problem !== null) {
    throw new Error(`Board validation failed: ${problem}`);
  }

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`, { mode: 0o644 });
  writeFileSync(join(outputDir, 'data.js'), `window.RADAR_DATA = ${JSON.stringify(payload)};\n`, { mode: 0o644 });

  const dashFiles = copyFlatDir(join(ROOT, 'dashboard'), join(outputDir, 'dashboard'));
  const shotFiles = copyFlatDir(join(ROOT, 'screenshots'), join(outputDir, 'screenshots'));
  if (shotFiles.length < 3 || shotFiles.length > SHOT_CAPS.max) {
    throw new Error(`Expected 3..${SHOT_CAPS.max} screenshots, found ${shotFiles.length}`);
  }
  if (!dashFiles.includes('index.html')) {
    throw new Error('dashboard/index.html is required');
  }

  const dossier = buildDossier(outputDir, {
    text_max_bytes: DOSSIER_TEXT_MAX,
    screenshots: SHOT_CAPS,
    dashboard: DASH_CAPS,
  });
  writeFileSync(join(outputDir, 'dossier.json'), dossier, { mode: 0o644 });

  process.stdout.write(
    `token-launch-radar: ranked ${board.length} pre-token protocols (${payload.watchlist_count} watchlist, ${payload.early_count} early) ` +
      `using ${payload.clean_peer_count} clean traded peers | LOO=${payload.model.loo_mult}x WF=${payload.model.wf_mult}x (starter ${payload.model.starter_mult}x) | ` +
      `dashboard=${dashFiles.length} files, screenshots=${shotFiles.length}, dossier=${dossier.byteLength} bytes\n`,
  );
}

main();

/*
 * High-level JavaScript API for the WebAssembly build of the
 * Macroassembler AS.
 *
 * Lives next to the emscripten-generated <tool>.js / <tool>.wasm files
 * (dist/ directory produced by wasm/build.sh).
 *
 * Two layers are provided:
 *
 *   assemble()     - one-shot convenience: feed source files in, run asl,
 *                    get exit code, log lines and all produced files back.
 *
 *   createASL()    - a persistent session exposing the raw emscripten
 *                    module and its in-memory filesystem (MEMFS), so users
 *                    can wire up their own file system bridging (e.g. lazy
 *                    loading of include files) and logging callbacks.
 */

const DEFAULT_TOOL = 'asl';

// In-memory cache of downloaded .wasm binaries, keyed by resolved URL.
// Fresh module instances are created from the cached bytes (via the
// emscripten `wasmBinary` option), so repeated runs never hit the network.
const wasmCache = new Map();

function fetchWasmBinary(url) {
  const key = String(url);
  if (!wasmCache.has(key)) {
    wasmCache.set(key, fetch(url).then((res) => {
      if (!res.ok) throw new Error(`failed to fetch ${url}: HTTP ${res.status}`);
      return res.arrayBuffer();
    }));
    wasmCache.get(key).catch(() => wasmCache.delete(key));
  }
  return wasmCache.get(key);
}

async function loadFactory(tool, factory) {
  if (factory) return factory;
  const mod = await import(new URL(`./${tool}.js`, import.meta.url));
  return mod.default;
}

function normalizePath(path) {
  return path.startsWith('/') ? path : `/${path}`;
}

export class ASLSession {
  constructor(module, { onStdout, onStderr } = {}) {
    this.module = module;
    this.fs = module.FS;
    this.onStdout = onStdout || null;
    this.onStderr = onStderr || null;
  }

  mkdirTree(path) {
    const parts = normalizePath(path).split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      try {
        this.fs.mkdir(current);
      } catch (err) {
        if (err && err.code !== 'EEXIST') throw err;
      }
    }
  }

  /** Write a map of { path: string | Uint8Array } into the virtual FS. */
  writeFiles(files) {
    for (const [name, content] of Object.entries(files)) {
      const path = normalizePath(name);
      const dir = path.slice(0, path.lastIndexOf('/'));
      if (dir) this.mkdirTree(dir);
      this.fs.writeFile(path, content);
    }
  }

  /** Read a file from the virtual FS as Uint8Array (null if missing). */
  readFile(path) {
    try {
      return this.fs.readFile(normalizePath(path));
    } catch {
      return null;
    }
  }

  /** Recursively list all regular files below dir (default: whole FS). */
  listFiles(dir = '/') {
    const result = [];
    const walk = (path) => {
      for (const entry of this.fs.readdir(path)) {
        if (entry === '.' || entry === '..') continue;
        const full = path === '/' ? `/${entry}` : `${path}/${entry}`;
        const stat = this.fs.stat(full);
        if (this.fs.isDir(stat.mode)) {
          if (full === '/dev' || full === '/proc') continue;
          walk(full);
        } else if (this.fs.isFile(stat.mode)) {
          result.push(full);
        }
      }
    };
    walk(normalizePath(dir));
    return result;
  }

  /**
   * Run the assembler with the given command line arguments
   * (e.g. ['-L', '/work/main.asm']). Returns the process exit code.
   */
  run(args) {
    // Under Node.js, the emscripten runtime forwards the WASM program's
    // exit code to process.exitCode.  A library call must not decide the
    // host process' exit code, so preserve/restore it around the run.
    const isNode = typeof process === 'object' && process !== null && 'exitCode' in process;
    const savedExitCode = isNode ? process.exitCode : undefined;
    try {
      const ret = this.module.callMain(args);
      return { exitCode: typeof ret === 'number' ? ret : 0 };
    } catch (err) {
      if (err && err.name === 'ExitStatus') return { exitCode: err.status };
      throw err;
    } finally {
      if (isNode) process.exitCode = savedExitCode;
    }
  }
}

/**
 * Create a persistent ASL session.
 *
 * Options:
 *   tool      - which binary to load ('asl', 'p2bin', 'p2hex', ...)
 *   onStdout  - callback invoked with every line written to stdout
 *   onStderr  - callback invoked with every line written to stderr
 *   locateFile- custom locator for the .wasm file (e.g. CDN URL mapping)
 *   factory   - custom emscripten module factory (skips the built-in
 *               dynamic import of ./<tool>.js)
 *   moduleOptions - extra options passed through to the emscripten factory
 *
 * The .wasm binary is fetched once per page load and cached in memory;
 * repeated createASL()/assemble() calls instantiate fresh modules from the
 * cached bytes without further network requests.
 */
export async function createASL({
  tool = DEFAULT_TOOL,
  onStdout = null,
  onStderr = null,
  locateFile = undefined,
  factory = undefined,
  moduleOptions = {},
} = {}) {
  const create = await loadFactory(tool, factory);
  // resolve the .wasm URL exactly like emscripten would, then serve it
  // from the in-memory cache instead of re-fetching on every run
  const wasmUrl = locateFile
    ? locateFile(`${tool}.wasm`, '')
    : new URL(`./${tool}.wasm`, import.meta.url);
  let wasmBinary = moduleOptions.wasmBinary;
  if (!wasmBinary) {
    try {
      wasmBinary = await fetchWasmBinary(wasmUrl);
    } catch {
      // not fetchable (e.g. file:// URL in Node.js) - let the emscripten
      // runtime load the binary itself instead
      wasmBinary = undefined;
    }
  }
  const module = await create({
    print: (text) => { if (onStdout) onStdout(text); },
    printErr: (text) => { if (onStderr) onStderr(text); },
    ...(locateFile ? { locateFile } : {}),
    ...moduleOptions,
    wasmBinary,
  });
  return new ASLSession(module, { onStdout, onStderr });
}

/**
 * One-shot assembly: creates a fresh WASM instance (ASL keeps global
 * state, so a new instance per run is the safe route), writes the given
 * files into its virtual FS, runs the tool and collects everything the
 * run produced.
 *
 *   const result = await assemble({
 *     files: { 'main.asm': ' cpu 6809\n org $8000\n ...' },
 *     args: ['-L', '/main.asm'],
 *     onStderr: (line) => console.warn(line),
 *   });
 *   // result.outputs['/main.p'] -> Uint8Array with the code file
 *
 * Returns { exitCode, stdout, stderr, outputs } where stdout/stderr are
 * the captured log lines and outputs maps paths to Uint8Array contents
 * (input files are excluded).
 */
export async function assemble({
  files = {},
  args = [],
  tool = DEFAULT_TOOL,
  onStdout = null,
  onStderr = null,
  locateFile = undefined,
  factory = undefined,
  moduleOptions = {},
} = {}) {
  const stdout = [];
  const stderr = [];
  const session = await createASL({
    tool,
    locateFile,
    factory,
    moduleOptions,
    onStdout: (line) => { stdout.push(line); if (onStdout) onStdout(line); },
    onStderr: (line) => { stderr.push(line); if (onStderr) onStderr(line); },
  });

  const inputs = new Set(Object.keys(files).map(normalizePath));
  session.writeFiles(files);
  const { exitCode } = session.run(args);

  const outputs = {};
  for (const path of session.listFiles('/')) {
    if (inputs.has(path)) continue;
    const data = session.readFile(path);
    if (data) outputs[path] = data;
  }

  return { exitCode, stdout, stderr, outputs };
}

export default { createASL, assemble, ASLSession };

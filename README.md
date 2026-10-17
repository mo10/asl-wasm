# asl-wasm

WebAssembly port of Alfred Arnold's [Macroassembler AS](http://john.ccac.rwth-aachen.de:8000/as/)
([upstream source](https://github.com/Macroassembler-AS/asl-releases) as a git
submodule in `asl-release/`).

`asl` and the companion tools (`plist`, `alink`, `pbind`, `p2hex`, `p2bin`)
are built with Emscripten into ES modules that run in the browser (web worker
and Node.js work too), with an in-memory filesystem and callback-based I/O so
the host page stays in full control.

## Building

Requirements: [Emscripten](https://emscripten.org/) (`emcc` in `PATH`),
a native C compiler and GNU make.

```sh
git submodule update --init
./wasm/build.sh        # writes the modules to dist/
node js/smoke-test.mjs # optional: verify the build
```

The build leaves the upstream tree untouched: the only files created inside
`asl-release/` are the untracked `Makefile.def` (which upstream's build system
expects to be supplied per platform) and the object directories
`obj-host/` / `obj-wasm/`. To remove them again:

```sh
git -C asl-release clean -fdx
```

Updating to a newer upstream release is just `git -C asl-release pull`
followed by `./wasm/build.sh` — there is no local patch set to rebase.

## Demo

Try it online: **https://mo10.github.io/asl-wasm/demo/** — a small multi-file
editor that assembles entirely client-side (page source: `demo/index.html`).

Prebuilt modules (`dist/` contents) are attached to every
[GitHub release](https://github.com/mo10/asl-wasm/releases) — no build needed
if you just want to use them.

## Usage

The build output is plain ES modules; import them from any page served over
HTTP:

```html
<script type="module">
import { assemble } from './dist/index.js';

const result = await assemble({
  // files to place into the virtual filesystem
  files: { 'main.asm': ' cpu 6809\n org $8000\n lda #$42\n end\n' },
  // command line arguments, as on the real command line
  args: ['-L', '/main.asm'],
  // callbacks for console output
  onStdout: (line) => console.log(line),
  onStderr: (line) => console.error(line),
});

result.exitCode;              // 0 on success
result.outputs['/main.p'];    // Uint8Array with the generated code file
result.outputs['/main.lst'];  // the listing (-L)
</script>
```

If the modules are hosted somewhere else (CDN, different path), pass
`locateFile: (path) => myBaseUrl + path` to tell the loader where the
`.wasm` file lives.

Each `.wasm` binary is downloaded only once per page load and cached in
memory — repeated `assemble()` / `createASL()` calls instantiate fresh
modules from the cached bytes without further network requests.

For more control — e.g. chaining `asl` and `p2bin`, keeping a filesystem
alive between runs, or bridging your own storage — use a persistent session
and the raw emscripten FS API:

```js
import { createASL } from './dist/index.js';

const asl = await createASL({ onStderr: console.error });
asl.writeFiles({ 'main.asm': source });      // or asl.fs.writeFile(...)
const { exitCode } = asl.run(['-L', '/main.asm']);
const codeFile = asl.readFile('/main.p');    // or asl.fs.readFile(...)

const p2bin = await createASL({ tool: 'p2bin' });
p2bin.writeFiles({ 'main.p': codeFile });
p2bin.run(['/main.p', '/main.bin']);
const binary = p2bin.readFile('/main.bin');
```

`createASL(options)` accepts:

| option | description |
| --- | --- |
| `tool` | which binary to load: `asl` (default), `plist`, `alink`, `pbind`, `p2hex`, `p2bin` |
| `onStdout` / `onStderr` | callback per output line |
| `locateFile` | custom `.wasm` locator, e.g. for CDN hosting |
| `factory` | supply your own emscripten module factory instead of importing `./<tool>.js` |
| `moduleOptions` | extra options passed through to the emscripten factory |

Each instance has its own private in-memory filesystem (MEMFS) — input files
are provided with `writeFiles()` and results read back with `readFile()`.
Because AS keeps global state, create a fresh session per run (the `assemble()`
helper does this for you).


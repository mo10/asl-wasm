// Smoke test for the WASM build of ASL: assemble a small 6809 program
// and convert the resulting .p code file to a raw binary with p2bin.
//
// Run with: node js/smoke-test.mjs   (after wasm/build.sh)
import { strict as assert } from 'node:assert';
import { createASL, assemble } from '../dist/index.js';

const SOURCE = `            cpu     6809
            org     $8000
start:      lda     #$42
            ldb     #start>>8
            bra     start
            end
`;

// 1) one-shot high-level API, with logging callback
const lines = [];
const result = await assemble({
  files: { 'work/main.asm': SOURCE },
  args: ['-L', '-q', '/work/main.asm'],
  onStderr: (line) => lines.push(line),
});

assert.equal(result.exitCode, 0, `asl failed: ${lines.join('\n')}`);
assert.ok(result.outputs['/work/main.p'], 'code file main.p was produced');
assert.ok(result.outputs['/work/main.lst'], 'listing main.lst was produced');
console.log(`asl OK: main.p = ${result.outputs['/work/main.p'].length} bytes, ` +
            `main.lst = ${result.outputs['/work/main.lst'].length} bytes`);

// 2) persistent session + raw FS access: run p2bin on the code file
const session = await createASL({ tool: 'p2bin' });
session.writeFiles({ 'main.p': result.outputs['/work/main.p'] });
const run = session.run(['/main.p', '/main.bin']);
assert.equal(run.exitCode, 0, 'p2bin failed');
const bin = session.readFile('/main.bin');
assert.ok(bin && bin.length > 0, 'main.bin was produced');
assert.equal(bin[0], 0x86, 'first byte is LDA #imm opcode');
assert.equal(bin[1], 0x42, 'operand is $42');
console.log(`p2bin OK: main.bin = [${[...bin].map((b) => b.toString(16).padStart(2, '0')).join(' ')}]`);

// 3) error path: faulty source must report a non-zero exit code
const bad = await assemble({
  files: { 'bad.asm': ' cpu 6809\n org $8000\n nonsense_opcode\n' },
  args: ['bad.asm'],
});
assert.notEqual(bad.exitCode, 0, 'faulty source must fail');
assert.ok(bad.stderr.length > 0, 'error messages were captured');
console.log(`error handling OK: exit=${bad.exitCode}, first error: ${bad.stderr[0]}`);

console.log('all smoke tests passed');

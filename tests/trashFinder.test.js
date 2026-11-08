const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { create } = require('../src/trashFinder');

test('Finder usa comandos fixos sem shell, com chamadas separadas para ler e esvaziar', async () => {
  const calls = [];
  const finder = create({ exec: (command, args, options, done) => {
    calls.push({ command, args, options });
    new vm.Script(args[3]); // valida a sintaxe sem executar AppleEvents
    done(null, JSON.stringify({ ok: true, value: calls.length === 1 ? ['/Users/test/.Trash/item'] : null }));
  } });
  assert.deepEqual(await finder.list(), ['/Users/test/.Trash/item']);
  await finder.empty();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, '/usr/bin/osascript');
  assert.deepEqual(calls[0].args.slice(0, 3), ['-l', 'JavaScript', '-e']);
  assert.match(calls[0].args[3], /finder\.trash\.items\(\)/);
  assert.doesNotMatch(calls[0].args[3], /finder\.empty\(/);
  assert.match(calls[1].args[3], /finder\.empty\(finder\.trash\)/);
  assert.equal(calls[1].options.timeout, 120000);
  assert.equal(calls[1].options.shell, undefined);
});

test('Finder preserva erro de autorização e recusa respostas inválidas', async () => {
  const finder = create({ exec: (_cmd, _args, _options, done) => {
    done(null, JSON.stringify({ ok: false, code: -1743, message: 'Not authorized' }));
  } });
  await assert.rejects(finder.list(), error => error.code === -1743);
  const invalid = create({ exec: (_cmd, _args, _options, done) => {
    done(null, JSON.stringify({ ok: true, value: ['relative/path'] }));
  } });
  await assert.rejects(invalid.list(), error => error.code === 'FINDER_RESPONSE');
});

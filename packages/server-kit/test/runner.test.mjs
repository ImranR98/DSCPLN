import test from 'node:test'
import assert from 'node:assert/strict'
import { Runner } from '../runner.mjs'

test('runner: streams lines and reports success', async () => {
  const runner = new Runner({})
  const lines = []
  runner.onLine((line) => lines.push(line))
  const result = await runner.run('echo hello && echo err >&2')
  assert.equal(result.ok, true)
  assert.equal(result.exitCode, 0)
  assert.ok(lines.some((l) => l.includes('hello')))
  assert.ok(lines.some((l) => l.includes('err')))
  assert.equal(runner.running, false)
})

test('runner: failure exit code stops the command chain', async () => {
  const runner = new Runner({})
  const result = await runner.run(['false', 'echo should-not-run'])
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 1)
  assert.ok(!runner.recent().some((l) => l.includes('should-not-run')))
})

test('runner: one active run at a time', async () => {
  const runner = new Runner({})
  const first = runner.run('sleep 5')
  await new Promise((resolve) => setTimeout(resolve, 100))
  await assert.rejects(() => runner.run('echo second'), /already active/)
  runner.cancel()
  const result = await first
  assert.equal(result.cancelled, true)
  assert.equal(result.ok, false)
})

test('runner: cancel kills the process group', async () => {
  const runner = new Runner({})
  const started = runner.run('sleep 30')
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(runner.cancel(), true)
  const result = await started
  assert.equal(result.cancelled, true)
  assert.notEqual(result.exitCode, 0)
})

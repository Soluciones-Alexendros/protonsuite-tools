/**
 * T-PROC-01 — Supervisor de procesos externos (hallazgo F24).
 *
 * Los casos que se prueban son justo los que rompían antes: un comando que lee
 * de la entrada con secreto VACÍO —`if (input)` no se cumplía, `stdin` no se
 * cerraba y el proceso se quedaba esperando para siempre—, uno que ignora la
 * señal, y uno que escupe bytes sin parar.
 *
 * Se usa el propio Node como «binario de pruebas»: evita ficheros fixture y deja
 * el comportamiento a la vista en cada test.
 */
import { describe, expect, it } from 'vitest'
import { looksLikeExecutable, runProcess } from '../src/process-runner.js'

const node = (code: string) => ({ file: process.execPath, args: ['-e', code] })

describe('T-PROC-01 · límites del lanzador', () => {
  it('un proceso que lee de la entrada TERMINA con entrada vacía', async () => {
    // Era el fallo exacto: `pass insert --multiline` con secreto vacío.
    const res = await runProcess({
      ...node("process.stdin.on('end', () => process.exit(0)); process.stdin.resume();"),
      input: '',
      timeoutMs: 4000,
    })

    expect(res.ok).toBe(true)
    expect(res.code).toBe(0)
  })

  it('sin entrada declarada, también se cierra stdin y el proceso termina', async () => {
    const res = await runProcess({
      ...node("process.stdin.on('end', () => process.exit(0)); process.stdin.resume();"),
      timeoutMs: 4000,
    })

    expect(res.ok).toBe(true)
  })

  it('devuelve la salida del proceso', async () => {
    const res = await runProcess(node("process.stdout.write('hola')"))
    expect(res.ok).toBe(true)
    expect(res.stdout).toBe('hola')
  })

  it('pasa la entrada al proceso', async () => {
    const res = await runProcess({
      ...node("process.stdin.on('data', d => { process.stdout.write(d); }); process.stdin.on('end', () => process.exit(0));"),
      input: 'secreto-de-prueba',
    })
    expect(res.stdout).toBe('secreto-de-prueba')
  })

  it('un proceso que no termina se mata por deadline', async () => {
    const res = await runProcess({
      ...node('setInterval(() => {}, 1000)'),
      timeoutMs: 700,
    })

    expect(res.ok).toBe(false)
    expect(res.failure).toBe('timeout')
    expect(res.message).toContain('700')
  })

  it('si ignora el SIGTERM, se insiste con SIGKILL', async () => {
    const res = await runProcess({
      ...node("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"),
      timeoutMs: 500,
    })

    expect(res.ok).toBe(false)
    expect(res.failure).toBe('timeout')
  })

  it('una salida sin freno se corta', async () => {
    // Escribe mucho, pero cediendo el control: así el corte lo decide el límite
    // y no el deadline, que es lo que se quiere comprobar aquí.
    const programa = [
      "const trozo = Buffer.alloc(1024, 120);",
      'let n = 0;',
      'const escribir = () => {',
      '  if (n++ > 100000) return;',
      '  process.stdout.write(trozo);',
      '  setImmediate(escribir);',
      '};',
      'escribir();',
    ].join('\n')

    const res = await runProcess({
      ...node(programa),
      maxOutputBytes: 64 * 1024,
      timeoutMs: 8000,
    })

    expect(res.ok).toBe(false)
    expect(res.failure).toBe('output-limit')
    expect(res.message).toContain('bytes')
  }, 15000)

  it('un código de salida distinto de cero se reporta con su motivo', async () => {
    const res = await runProcess({
      ...node("process.stderr.write('algo fue mal'); process.exit(3)"),
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe(3)
    expect(res.failure).toBe('non-zero-exit')
    expect(res.message).toContain('algo fue mal')
  })

  it('un binario que no existe no revienta: se reporta', async () => {
    const res = await runProcess({
      file: '/no/existe/este/binario',
      timeoutMs: 3000,
    })

    expect(res.ok).toBe(false)
    expect(res.failure).toBe('spawn-error')
  })

  it('se puede cancelar', async () => {
    const controller = new AbortController()
    const promesa = runProcess({
      ...node('setInterval(() => {}, 1000)'),
      signal: controller.signal,
      timeoutMs: 10_000,
    })
    controller.abort()

    const res = await promesa
    expect(res.ok).toBe(false)
    expect(res.failure).toBe('aborted')
  })

  it('una señal ya cancelada no lanza nada', async () => {
    const controller = new AbortController()
    controller.abort()

    const res = await runProcess({
      ...node("process.stdout.write('no debería llegar')"),
      signal: controller.signal,
    })

    expect(res.ok).toBe(false)
    expect(res.failure).toBe('aborted')
  })
})

describe('nombres de ejecutable', () => {
  it('acepta rutas absolutas y nombres simples', () => {
    expect(looksLikeExecutable('/usr/bin/pass')).toBe(true)
    expect(looksLikeExecutable('proton-drive')).toBe(true)
  })

  it('rechaza lo que parece una orden', () => {
    expect(looksLikeExecutable('')).toBe(false)
    expect(looksLikeExecutable('   ')).toBe(false)
    expect(looksLikeExecutable('pass insert --force')).toBe(false)
    expect(looksLikeExecutable('rm -rf /')).toBe(false)
  })
})

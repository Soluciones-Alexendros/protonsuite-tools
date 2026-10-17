import { mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DriveAuditor } from '../src/drive-audit.js'
import { hashFile } from '../src/drive-utils.js'

const TMP = '/tmp/test-drive-audit'

describe('DriveAuditor', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
    mkdirSync(resolve(TMP, 'docs'), { recursive: true })
    mkdirSync(resolve(TMP, 'images'), { recursive: true })
    writeFileSync(resolve(TMP, 'readme.md'), '# Hello')
    writeFileSync(resolve(TMP, 'docs', 'report.doc'), 'old format')
    writeFileSync(resolve(TMP, 'docs', 'notes.txt'), 'some notes')
    writeFileSync(resolve(TMP, 'images', 'photo.jpg'), Buffer.alloc(1024))
    writeFileSync(resolve(TMP, 'duplicate.txt'), 'same content')
    writeFileSync(resolve(TMP, 'docs', 'duplicate.txt'), 'same content')
  })

  afterEach(() => {
    rmSync(TMP, { recursive: true, force: true })
  })

  const auditor = new DriveAuditor(['.doc', '.ppt', '.xls', '.bmp'], {
    debug: () => {},
    info: () => {},
    error: () => {},
  })

  it('should scan inventory', async () => {
    const inv = await auditor.scanInventory(TMP)
    expect(inv.totalFiles).toBe(6)
    expect(inv.totalBytes).toBeGreaterThan(0)
    expect(inv.byExt['.md']).toBe(1)
    expect(inv.byExt['.doc']).toBe(1)
    expect(inv.byExt['.txt']).toBe(3)
    expect(inv.byExt['.jpg']).toBe(1)
  })

  it('should detect duplicates by content', async () => {
    const esperado = await hashFile(resolve(TMP, 'duplicate.txt'))
    const dups = await auditor.findDuplicates(TMP)
    expect(dups.length).toBeGreaterThanOrEqual(1)
    const dup = dups.find(
      (d) => d.hash === esperado,
    )
    expect(dup).toBeDefined()
    expect(dup!.files.length).toBe(2)
  })

  it('should report obsolete formats', async () => {
    const fmt = await auditor.formatReport(TMP)
    expect(fmt.obsoleteFiles.length).toBe(1)
    expect(fmt.obsoleteFiles[0].name).toBe('report.doc')
    expect(fmt.obsoleteExtensions).toEqual(['.doc', '.ppt', '.xls', '.bmp'])
  })

  it('should build organize plan', async () => {
    const plan = await auditor.buildOrganizePlan(TMP)
    expect(plan.suggestions.length).toBeGreaterThanOrEqual(1)
  })

  it('registra un enlace roto sin seguirlo ni romperse (F25)', async () => {
    try {
      symlinkSync('/nonexistent', resolve(TMP, 'broken.lnk'))
    } catch { /* platform may not support symlinks, skip test */
      return
    }
    const inv = await auditor.scanInventory(TMP)
    // Antes el enlace se seguía y `stat` fallaba, así que se descartaba en
    // silencio. Ahora se ve como lo que es —un enlace— y no se atraviesa.
    const found = inv.files.find((f) => f.name === 'broken.lnk')
    expect(found).toBeDefined()
  })

  it('skips entries when stat fails in findDuplicates (broken symlink)', async () => {
    try {
      symlinkSync('/nonexistent', resolve(TMP, 'broken2.lnk'))
    } catch { /* platform may not support symlinks, skip test */
      return
    }
    const dups = await auditor.findDuplicates(TMP)
    expect(Array.isArray(dups)).toBe(true)
  })
})

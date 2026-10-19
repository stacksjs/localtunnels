/**
 * Every native tag these screens use resolves on a case-sensitive disk.
 *
 * The bug this exists for cost a day of red CI. stx resolves `<tag>` by
 * trying three filenames — the tag as written, its kebab-to-PascalCase form,
 * and its camel-to-kebab form — and the primitives are PascalCase files like
 * `ScrollView.stx`. For `<scrollview>` that yields `scrollview.stx` and
 * `Scrollview.stx`, and neither is the file.
 *
 * On macOS it worked anyway, because the filesystem is case-insensitive. On
 * Linux the component "rendered as nothing" — and since the whole screen was
 * inside it, every screen compiled to one empty node with no bindings. The
 * build reported success, every assertion failed on node counts, and nothing
 * anywhere said the word `scrollview`.
 *
 * So the rule is checked here rather than discovered there: a tag whose
 * PascalCase form is not exactly a file is a tag that works on one machine.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCREENS = join(PACKAGE_DIR, 'screens')
const PRIMITIVES = resolve(PACKAGE_DIR, '..', '..', 'node_modules', '@stacksjs', 'stx', 'dist', 'native', 'primitives')

/** stx's own candidate filenames for a tag, in its own order. */
function candidates(tag: string): string[] {
  const pascal = tag.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('')
  const kebab = tag.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
  return [...new Set([`${tag}.stx`, `${pascal}.stx`, `${kebab}.stx`])]
}

/**
 * Tags the screens actually render.
 *
 * Scripts and comments are stripped first. Without that this reads the prose
 * — these files explain which primitives they use, and a comment naming
 * `<scrollview>` is not the screen using one.
 */
function tagsUsed(): string[] {
  const html = new Set(['a', 'div', 'span', 'p', 'view', 'text', 'icon', 'switch', 'slot'])
  const found = new Set<string>()
  for (const file of readdirSync(SCREENS).filter(name => name.endsWith('.stx'))) {
    const markup = readFileSync(join(SCREENS, file), 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\{\{--[\s\S]*?--\}\}/g, '')
    for (const match of markup.matchAll(/<([a-z][a-z0-9-]*)[\s/>]/g)) {
      if (!html.has(match[1]))
        found.add(match[1])
    }
  }
  return [...found].sort()
}

/** The primitives on disk, by their real spelling. */
const onDisk = existsSync(PRIMITIVES) ? readdirSync(PRIMITIVES) : []

describe('the native tags these screens use', () => {
  it('finds the primitives directory at all', () => {
    expect(onDisk.length).toBeGreaterThan(0)
  })

  /*
   * The check itself. A tag only resolves if one of stx's three candidates
   * is a file *exactly*, which is what `readdirSync` compares and what a
   * case-sensitive disk enforces.
   */
  it('each resolve to a primitive by its exact name', () => {
    /*
     * Only tags that name a primitive at all are checked: a plain HTML tag
     * the renderer maps itself is not a missing component. A tag that does
     * name one, in a spelling none of the candidates match, is the bug.
     */
    const unresolved = tagsUsed()
      .filter(tag => onDisk.some(file => file.toLowerCase() === `${tag.replace(/-/g, '')}.stx`))
      .filter(tag => !candidates(tag).some(name => onDisk.includes(name)))
    expect(unresolved).toEqual([])
  })

  /*
   * The exact case that broke, kept as a case of its own: `scrollview` is
   * the spelling that reads naturally and is the one that does not work.
   */
  it('would reject the spelling that only worked on macOS', () => {
    expect(onDisk).toContain('ScrollView.stx')
    expect(candidates('scrollview')).not.toContain('ScrollView.stx')
    expect(candidates('scroll-view')).toContain('ScrollView.stx')
  })
})

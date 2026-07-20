import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'

const root = process.cwd()
const publicRoots = [join(root, 'README.md'), join(root, 'docs')]
const failures = []

async function collectMarkdown(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null)
  if (!entries) return extname(path).toLowerCase() === '.md' ? [path] : []

  const files = []
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) files.push(...await collectMarkdown(child))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') files.push(child)
  }
  return files
}

function normalizeTarget(rawTarget) {
  const unwrapped = rawTarget.trim().replace(/^<|>$/g, '')
  const withoutTitle = unwrapped.replace(/\s+["'][^"']*["']\s*$/, '')
  return decodeURIComponent(withoutTitle.split('#', 1)[0].split('?', 1)[0])
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const markdownFiles = (await Promise.all(publicRoots.map(collectMarkdown))).flat().sort()
const markdownLinkPattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/g

for (const file of markdownFiles) {
  const content = await readFile(file, 'utf8')
  const relativeFile = file.slice(root.length + 1)

  for (const match of content.matchAll(markdownLinkPattern)) {
    const [, imageMarker, label, rawTarget] = match
    const isImage = imageMarker === '!'
    if (isImage && label.trim().length === 0) failures.push(`${relativeFile}: image has no alternative text (${rawTarget})`)

    const target = normalizeTarget(rawTarget)
    if (!target || /^(?:https?:|mailto:)/i.test(target)) continue
    const absoluteTarget = resolve(dirname(file), target)
    if (!absoluteTarget.startsWith(root)) {
      failures.push(`${relativeFile}: link points outside the repository (${rawTarget})`)
      continue
    }
    if (!await exists(absoluteTarget)) failures.push(`${relativeFile}: target does not exist (${rawTarget})`)
  }
}

if (failures.length > 0) {
  console.error(`Invalid documentation (${failures.length} findings):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Documentation is valid: ${markdownFiles.length} Markdown files checked.`)
}

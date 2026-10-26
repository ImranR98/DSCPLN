// Browser-side .tar.gz pruning for archive uploads.
//
// Some exports (GitHub account data) are tens of GB of repositories/release
// assets wrapped around a few MB of JSON. The upload endpoint only sees bytes,
// so the only way to avoid sending the bulk is to rewrite the tar locally.
//
// This keeps the original tar headers (and therefore names, modes and PAX/GNU
// long-name records) and streams the retained members into a new gzip. It is
// deliberately limited to top-level prefixes: that is all the export pruning
// needs, and it avoids trying to be a general-purpose tar editor.

const BLOCK = 512
const COPY_CHUNK = 64 * 1024
const ZERO_BLOCK = new Uint8Array(BLOCK)
const decoder = new TextDecoder()

const normalizePath = (value) => String(value).replace(/^\.\/+/, '').replace(/\/+$/, '')

function field(header, start, length) {
  let end = start
  while (end < start + length && header[end] !== 0) end++
  return decoder.decode(header.subarray(start, end))
}

function parseSize(header) {
  const bytes = header.subarray(124, 136)
  if (bytes[0] & 0x80) {
    let value = 0
    for (let i = 1; i < bytes.length; i++) value = value * 256 + bytes[i]
    return value
  }
  const text = decoder.decode(bytes).replace(/\0.*$/, '').trim()
  return text ? Number.parseInt(text, 8) : 0
}

function isZeroBlock(block) {
  for (let i = 0; i < block.length; i++) if (block[i] !== 0) return false
  return true
}

function parsePax(data) {
  const values = {}
  let offset = 0
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset)
    if (space < 0) break
    const length = Number.parseInt(decoder.decode(data.subarray(offset, space)), 10)
    if (!Number.isInteger(length) || length <= 0 || offset + length > data.length) break
    const record = data.subarray(space + 1, offset + length)
    const equals = record.indexOf(0x3d)
    if (equals > 0) {
      const key = decoder.decode(record.subarray(0, equals))
      const value = decoder.decode(record.subarray(equals + 1)).replace(/\n$/, '')
      values[key] = value
    }
    offset += length
  }
  return values
}

class ByteReader {
  constructor(reader) {
    this.reader = reader
    this.queue = []
    this.done = false
  }

  async fill() {
    while (!this.queue.length && !this.done) {
      const { value, done } = await this.reader.read()
      if (done) {
        this.done = true
        break
      }
      if (value?.length) this.queue.push(value)
    }
    return this.queue.length > 0
  }

  async readChunk(max) {
    if (!(await this.fill())) return null
    const head = this.queue[0]
    const take = Math.min(head.length, max)
    const chunk = head.subarray(0, take)
    if (take === head.length) this.queue.shift()
    else this.queue[0] = head.subarray(take)
    return chunk
  }

  async readExactly(length) {
    if (length === 0) return new Uint8Array(0)
    const output = new Uint8Array(length)
    let offset = 0
    while (offset < length) {
      const chunk = await this.readChunk(length - offset)
      if (!chunk) throw new Error('truncated tar archive')
      output.set(chunk, offset)
      offset += chunk.length
    }
    return output
  }

  async skip(length) {
    let left = length
    while (left > 0) {
      const chunk = await this.readChunk(Math.min(left, COPY_CHUNK))
      if (!chunk) throw new Error('truncated tar archive')
      left -= chunk.length
    }
  }
}

async function writeZeros(writer, length) {
  let left = length
  while (left > 0) {
    const take = Math.min(left, BLOCK)
    await writer.write(ZERO_BLOCK.subarray(0, take))
    left -= take
  }
}

const abortError = () => new Error('Upload cancelled')

export async function pruneTarGz(file, { drop = [], onProgress, signal } = {}) {
  if (typeof DecompressionStream !== 'function' || typeof CompressionStream !== 'function') {
    throw new Error('this browser cannot prune .tar.gz archives; upload a pre-pruned archive instead')
  }
  if (typeof File !== 'function' || typeof Response !== 'function' || typeof file.stream !== 'function') {
    throw new Error('this browser cannot prepare the pruned archive')
  }
  if (signal?.aborted) throw abortError()

  const prefixes = [...new Set(
    (Array.isArray(drop) ? drop : [drop])
      .map(normalizePath)
      .filter(Boolean)
  )]
  if (!prefixes.length) return file

  let read = 0
  const counter = new TransformStream({
    transform(chunk, controller) {
      read += chunk.byteLength
      onProgress?.(file.size ? Math.min(1, read / file.size) : 0)
      controller.enqueue(chunk)
    },
  })

  const decompressor = new DecompressionStream('gzip')
  const source = file.stream().pipeThrough(counter).pipeThrough(decompressor)
  const reader = new ByteReader(source.getReader())
  const gzip = new CompressionStream('gzip')
  const writer = gzip.writable.getWriter()
  const blobPromise = new Response(gzip.readable).blob()

  let aborted = false
  const abort = () => {
    aborted = true
    reader.reader.cancel().catch(() => {})
    writer.abort().catch(() => {})
  }
  signal?.addEventListener('abort', abort, { once: true })

  try {
    let pending = []
    let longName = null
    let paxName = null
    let paxSize = null
    let sawUsers = false

    while (true) {
      if (aborted) throw abortError()
      const header = await reader.readExactly(BLOCK)
      if (isZeroBlock(header)) break

      const type = String.fromCharCode(header[156] || 0x30)
      const headerSize = parseSize(header)
      const prefix = normalizePath(field(header, 345, 155))
      const rawName = field(header, 0, 100)
      const headerName = prefix ? `${prefix}/${rawName}` : rawName
      const isExtended = type === 'x' || type === 'g' || type === 'L' || type === 'K'

      if (isExtended) {
        const data = await reader.readExactly(headerSize)
        const padding = await reader.readExactly((BLOCK - (headerSize % BLOCK)) % BLOCK)
        pending.push(header)
        if (data.length) pending.push(data)
        if (padding.length) pending.push(padding)
        if (type === 'L') longName = decoder.decode(data).replace(/\0.*$/, '')
        if (type === 'x' || type === 'g') {
          const values = parsePax(data)
          if (values.path) paxName = values.path
          if (values.size !== undefined) {
            const value = Number(values.size)
            if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid PAX size')
            paxSize = value
          }
        }
        continue
      }

      const size = paxSize ?? headerSize
      const name = normalizePath(paxName ?? longName ?? headerName)
      const skip = prefixes.some((prefixName) => name === prefixName || name.startsWith(`${prefixName}/`))
      const paddedSize = (BLOCK - (size % BLOCK)) % BLOCK

      if (skip) {
        await reader.skip(size + paddedSize)
      } else {
        for (const chunk of pending) await writer.write(chunk)
        await writer.write(header)
        let left = size
        while (left > 0) {
          if (aborted) throw abortError()
          const chunk = await reader.readChunk(Math.min(left, COPY_CHUNK))
          if (!chunk) throw new Error('truncated tar archive')
          await writer.write(chunk)
          left -= chunk.length
        }
        await writeZeros(writer, paddedSize)
        await reader.skip(paddedSize)
        if (name === 'users_000001.json') sawUsers = true
      }

      pending = []
      longName = null
      paxName = null
      paxSize = null
    }

    await writeZeros(writer, BLOCK * 2)
    await writer.close()
    const blob = await blobPromise

    if (!sawUsers) {
      throw new Error('this archive does not look like a GitHub data export (users_000001.json missing)')
    }

    return new File([blob], file.name, { type: 'application/gzip', lastModified: file.lastModified })
  } catch (err) {
    writer.abort().catch(() => {})
    blobPromise.catch(() => {})
    if (aborted || signal?.aborted) throw abortError()
    throw err
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

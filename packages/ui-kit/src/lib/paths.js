// Dotted-path helpers for config forms (fields declare `path` like "ntfy.url").

export function getPath(object, path) {
  let node = object
  for (const part of String(path).split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[part]
  }
  return node
}

export function setPath(object, path, value) {
  const parts = String(path).split('.')
  let node = object
  for (const part of parts.slice(0, -1)) {
    if (node[part] == null || typeof node[part] !== 'object') node[part] = {}
    node = node[part]
  }
  node[parts.at(-1)] = value
  return object
}

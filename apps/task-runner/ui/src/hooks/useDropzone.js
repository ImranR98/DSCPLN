import { useEffect, useRef } from 'react'

// Click-to-browse + drag-and-drop on a dropzone element. Returns the ref to
// attach to the container (the hidden <input type=file> inside it is used).
export function useDropzone(handler) {
  const nodeRef = useRef(null)
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return undefined
    const onClick = () => node.querySelector('input[type=file]')?.click()
    const onDragOver = (event) => {
      event.preventDefault()
      node.classList.add('dragover')
    }
    const onDragLeave = () => node.classList.remove('dragover')
    const onDrop = (event) => {
      event.preventDefault()
      node.classList.remove('dragover')
      handlerRef.current(event.dataTransfer.files)
    }
    node.addEventListener('click', onClick)
    node.addEventListener('dragover', onDragOver)
    node.addEventListener('dragleave', onDragLeave)
    node.addEventListener('drop', onDrop)
    return () => {
      node.removeEventListener('click', onClick)
      node.removeEventListener('dragover', onDragOver)
      node.removeEventListener('dragleave', onDragLeave)
      node.removeEventListener('drop', onDrop)
    }
  }, [])

  return nodeRef
}

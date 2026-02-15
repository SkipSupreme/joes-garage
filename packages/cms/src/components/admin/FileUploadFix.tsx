'use client'

import React, { useEffect } from 'react'

/**
 * Fixes "Select a file" not opening a file dialog in Payload CMS.
 *
 * ROOT CAUSE: Payload renders <input type="file" hidden> and calls
 * inputRef.current.click() on it. The HTML `hidden` attribute applies
 * `display: none` via the browser's UA stylesheet, and .click() on a
 * display:none file input silently fails to open the file dialog.
 *
 * FIX: MutationObserver removes the `hidden` attribute from file inputs
 * as soon as they appear in the DOM, replacing it with inline styles
 * that keep the input visually hidden but still rendered (position: fixed,
 * off-screen). This way Payload's native .click() works because the
 * browser sees a visible element.
 *
 * A capture-phase click listener also runs as a safety net, ensuring the
 * input is fixed right before Payload's onClick handler fires.
 */
const FileUploadFix: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    const fixFileInput = (input: HTMLInputElement): void => {
      if (!input.hasAttribute('hidden')) return

      input.removeAttribute('hidden')
      input.hidden = false

      input.style.position = 'fixed'
      input.style.top = '-9999px'
      input.style.left = '-9999px'
      input.style.width = '1px'
      input.style.height = '1px'
      input.style.opacity = '0.01'
      input.style.pointerEvents = 'none'
      input.style.overflow = 'hidden'
    }

    // Fix any file inputs already in the DOM
    document.querySelectorAll<HTMLInputElement>('input[type="file"][hidden]').forEach(fixFileInput)

    // MutationObserver: fix file inputs as they're added or modified
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) return
            if (node.tagName === 'INPUT' && node.getAttribute('type') === 'file' && node.hasAttribute('hidden')) {
              fixFileInput(node as HTMLInputElement)
            }
            node.querySelectorAll<HTMLInputElement>('input[type="file"][hidden]').forEach(fixFileInput)
          })
        }
        if (mutation.type === 'attributes' && mutation.attributeName === 'hidden') {
          const target = mutation.target as HTMLElement
          if (target.tagName === 'INPUT' && target.getAttribute('type') === 'file' && target.hasAttribute('hidden')) {
            fixFileInput(target as HTMLInputElement)
          }
        }
      }
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    })

    // Capture-phase safety net: ensure the file input is fixed right
    // before Payload's React onClick handler fires.
    const clickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const button = target.closest('button')
      if (!button) return

      const text = button.textContent?.trim() || ''
      if (!text.includes('Select a file')) return

      const container = button.closest('.file-field__dropzoneButtons') || button.parentElement
      const fileInput = container?.querySelector('input[type="file"]') as HTMLInputElement | null
        || document.querySelector('input[type="file"]')

      if (fileInput && (fileInput.hasAttribute('hidden') || fileInput.hidden)) {
        fixFileInput(fileInput)
      }
      // DO NOT call stopPropagation/preventDefault — let Payload's handler work
    }

    document.addEventListener('click', clickHandler, true)

    return () => {
      observer.disconnect()
      document.removeEventListener('click', clickHandler, true)
    }
  }, [])

  return <>{children}</>
}

export default FileUploadFix

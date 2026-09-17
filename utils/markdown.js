function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineMarkdown(value) {
  const source = String(value || '')
  const parts = source.split(/(`+[^`\n]+`+)/g)
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return `<code style="padding:2px 8px;border-radius:6px;background:#F0F2F0;color:#5B665E;font-size:0.92em;">${escapeHtml(part.replace(/^`+|`+$/g, ''))}</code>`
    }

    let html = escapeHtml(part)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="color:#D96E00;text-decoration:underline;">$1</a>')
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>')
    html = html.replace(/~~(.+?)~~/g, '<del>$1</del>')
    html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    html = html.replace(/_([^_\n]+)_/g, '<em>$1</em>')
    return html
  }).join('')
}

function renderParagraph(lines) {
  if (!lines.length) return ''
  const text = lines.map((line) => renderInlineMarkdown(line)).join('<br/>')
  return `<p style="margin:0 0 18px;color:#2F3B33;font-size:15px;line-height:1.72;">${text}</p>`
}

function renderList(items, ordered) {
  const tag = ordered ? 'ol' : 'ul'
  const marker = ordered ? 'margin-left:22px;' : 'margin-left:20px;'
  return `<${tag} style="margin:0 0 18px;padding:0;${marker}color:#2F3B33;font-size:15px;line-height:1.72;">${items
    .map((item) => `<li style="padding-left:4px;margin:4px 0;">${renderInlineMarkdown(item)}</li>`)
    .join('')}</${tag}>`
}

/**
 * Convert the small, safe Markdown subset used by agent replies into the
 * HTML-like node string accepted by the Mini Program rich-text component.
 * It intentionally does not allow arbitrary HTML through from the model.
 */
function renderMarkdown(markdown) {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
  const output = []
  let paragraph = []
  let list = []
  let listOrdered = false
  let code = null

  const flushParagraph = () => {
    if (paragraph.length) output.push(renderParagraph(paragraph))
    paragraph = []
  }
  const flushList = () => {
    if (list.length) output.push(renderList(list, listOrdered))
    list = []
  }
  const flushBlocks = () => {
    flushParagraph()
    flushList()
  }

  lines.forEach((line) => {
    const fence = line.match(/^\s*```(?:[\w-]+)?\s*$/)
    if (fence) {
      if (code) {
        output.push(`<pre style="margin:0 0 18px;padding:16px;overflow-x:auto;border-radius:12px;background:#F3F5F3;color:#35443A;font-size:13px;line-height:1.6;white-space:pre-wrap;"><code>${escapeHtml(code.join('\n'))}</code></pre>`)
        code = null
      } else {
        flushBlocks()
        code = []
      }
      return
    }
    if (code) {
      code.push(line)
      return
    }

    const heading = line.match(/^\s*(#{1,3})\s+(.+?)\s*#*\s*$/)
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/)
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    const quote = line.match(/^\s*>\s?(.*)$/)

    if (!line.trim()) {
      flushBlocks()
    } else if (heading) {
      flushBlocks()
      const size = heading[1].length === 1 ? 20 : heading[1].length === 2 ? 18 : 16
      output.push(`<h${heading[1].length} style="margin:0 0 12px;color:#24332D;font-size:${size}px;font-weight:700;line-height:1.4;">${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`)
    } else if (unordered || ordered) {
      flushParagraph()
      const isOrdered = Boolean(ordered)
      if (list.length && listOrdered !== isOrdered) flushList()
      listOrdered = isOrdered
      list.push((unordered || ordered)[1])
    } else if (quote) {
      flushBlocks()
      output.push(`<blockquote style="margin:0 0 18px;padding:8px 14px;border-left:3px solid #F1B46D;background:#FFF8F0;color:#6D756E;font-size:14px;line-height:1.65;">${renderInlineMarkdown(quote[1])}</blockquote>`)
    } else {
      flushList()
      paragraph.push(line)
    }
  })

  if (code) {
    output.push(`<pre style="margin:0 0 18px;padding:16px;overflow-x:auto;border-radius:12px;background:#F3F5F3;color:#35443A;font-size:13px;line-height:1.6;white-space:pre-wrap;"><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  }
  flushBlocks()
  if (output.length) {
    const lastBlockIndex = output.length - 1
    output[lastBlockIndex] = output[lastBlockIndex].replace(/margin:0 0 \d+px;/, 'margin:0;')
  }
  return output.join('')
}

module.exports = { escapeHtml, renderMarkdown }

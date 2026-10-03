import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../lib/api'

export function Markdown({ children }: { children: string }): React.JSX.Element {
  return (
    <div className="selectable prose prose-zinc max-w-none prose-headings:tracking-tight prose-h1:text-xl prose-h2:text-lg prose-h3:text-base prose-table:text-sm dark:prose-invert">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault()
                if (href) void api.openExternal(href)
              }}
            >
              {children}
            </a>
          )
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

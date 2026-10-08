import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function MessageContent({ content }: { content: JsonValue }) {
  if (typeof content !== 'string') {
    return <pre className="mt-2 max-w-full overflow-x-auto rounded-lg bg-muted/40 p-3 text-xs leading-5"><code>{JSON.stringify(content, null, 2)}</code></pre>;
  }
  return (
    <div className="min-w-0 break-words text-sm leading-6 text-foreground/90 [&>*+*]:mt-3 [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:whitespace-pre-line [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted/40 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5 [&_hr]:border-border [&_input]:mr-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        table: ({ children }) => <div role="region" aria-label="Tabla de la respuesta" tabIndex={0} className="my-3 max-w-full overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring"><table className="w-full border-collapse text-left text-xs leading-5">{children}</table></div>,
        th: ({ children, style }) => <th style={style} className="border-b border-border bg-muted/60 px-3 py-2 font-semibold">{children}</th>,
        td: ({ children, style }) => <td style={style} className="border-b border-border/50 px-3 py-2 align-top">{children}</td>,
      }}>{content}</ReactMarkdown>
    </div>
  );
}

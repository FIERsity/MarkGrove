import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ImageOff } from "lucide-react";
import "katex/dist/katex.min.css";
import type { Language } from "../types";
import { message } from "../lib/i18n";
import { prepareMarkdownForReadingWithMap } from "../lib/mathReading";
import { safeExternalLink } from "../lib/renderPolicy";

interface Props {
  content: string;
  language: Language;
}

export function MarkdownPreview({ content, language }: Props) {
  if (!content.trim()) return <div className="empty-preview">{message(language, "emptyPreview")}</div>;
  const prepared = prepareMarkdownForReadingWithMap(content);
  const sourceOffset = (offset: number | undefined) => offset === undefined ? undefined : prepared.sourceOffsetAt(offset);
  return (
    <article className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: "warn", throwOnError: false, maxSize: 20, maxExpand: 1000 }]]}
        skipHtml
        components={{
          h1({ node, children, ...props }) { return <h1 {...props} data-source-from={sourceOffset(node?.position?.start.offset)}>{children}</h1>; },
          h2({ node, children, ...props }) { return <h2 {...props} data-source-from={sourceOffset(node?.position?.start.offset)}>{children}</h2>; },
          h3({ node, children, ...props }) { return <h3 {...props} data-source-from={sourceOffset(node?.position?.start.offset)}>{children}</h3>; },
          h4({ node, children, ...props }) { return <h4 {...props} data-source-from={sourceOffset(node?.position?.start.offset)}>{children}</h4>; },
          h5({ node, children, ...props }) { return <h5 {...props} data-source-from={sourceOffset(node?.position?.start.offset)}>{children}</h5>; },
          h6({ node, children, ...props }) { return <h6 {...props} data-source-from={sourceOffset(node?.position?.start.offset)}>{children}</h6>; },
          a({ href, children }) {
            const safe = safeExternalLink(href);
            return safe
              ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a>
              : <span className="unsafe-link">{children}</span>;
          },
          img({ alt }) {
            return (
              <span className="blocked-image" role="note">
                <ImageOff size={18} aria-hidden="true" />
                <span><strong>{message(language, "remoteImageBlocked")}</strong><small>{alt || message(language, "imageNotAvailable")}</small></span>
              </span>
            );
          },
          input(props) {
            return <input {...props} disabled />;
          },
        }}
      >
        {prepared.content}
      </ReactMarkdown>
    </article>
  );
}

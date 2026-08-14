import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ImageOff } from "lucide-react";
import type { Language } from "../types";
import { message } from "../lib/i18n";
import { safeExternalLink } from "../lib/renderPolicy";

interface Props {
  content: string;
  language: Language;
}

export function MarkdownPreview({ content, language }: Props) {
  if (!content.trim()) return <div className="empty-preview">{message(language, "emptyPreview")}</div>;
  return (
    <article className="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
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
        {content}
      </ReactMarkdown>
    </article>
  );
}

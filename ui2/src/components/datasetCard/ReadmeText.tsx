import React, { useMemo } from 'react';
import { cn } from '@/utils/cn';
import { isMarkdownFile, parseMarkdown, type Block, type Inline } from './safeMarkdown';

const CODE_INLINE = 'font-mono text-bf-xs text-bf-text-secondary';
const CODE_BLOCK =
  'm-0 whitespace-pre-wrap rounded-sm border border-bf-border-subtle bg-bf-bg-panel-sunken px-3 py-2.5 font-mono text-bf-xs leading-4 text-bf-text-secondary [overflow-wrap:anywhere]';

function renderInline(nodes: Inline[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}.${index}`;
    switch (node.type) {
      case 'text':
        return <React.Fragment key={key}>{node.text}</React.Fragment>;
      case 'code':
        return (
          <code key={key} className={CODE_INLINE}>
            {node.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={key} className="font-semibold">
            {renderInline(node.children, key)}
          </strong>
        );
      case 'em':
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case 'link':
        // Text only: the app has no vetted external-link opener, so a README
        // link is shown with its address and is not clickable.
        return (
          <span key={key} data-md-link>
            {node.text && node.text !== node.url ? `${node.text} ` : null}
            <span className={cn(CODE_INLINE, '[overflow-wrap:anywhere]')}>
              {node.text && node.text !== node.url ? `(${node.url})` : node.url}
            </span>
          </span>
        );
      case 'image':
        // Never fetched: the alt text stands in for the picture.
        return (
          <span key={key} data-md-image className="text-bf-text-muted">
            {node.alt ? `[Image: ${node.alt}]` : '[Image]'}
          </span>
        );
    }
  });
}

function renderBlock(block: Block, index: number): React.ReactNode {
  const key = `b${index}`;
  switch (block.type) {
    case 'heading': {
      // Modest sizes: a README title must not outrank the card's own title.
      const Tag = `h${Math.min(block.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag
          key={key}
          className={cn(
            'm-0 mt-1 font-semibold text-bf-text-primary first:mt-0',
            block.level <= 2 ? 'text-bf-md leading-5' : 'text-bf-sm leading-[18px]',
          )}
        >
          {renderInline(block.children, key)}
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p key={key} className="m-0 text-bf-md leading-5 text-bf-text-primary">
          {renderInline(block.children, key)}
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          start={block.ordered && block.start !== 1 ? block.start : undefined}
          className={cn(
            'm-0 flex flex-col gap-0.5 pl-[18px] text-bf-md leading-5 text-bf-text-primary',
            block.ordered ? 'list-decimal' : 'list-disc',
          )}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`${key}.${itemIndex}`}>{renderInline(item, `${key}.${itemIndex}`)}</li>
          ))}
        </Tag>
      );
    }
    case 'code':
      return (
        <pre key={key} className={CODE_BLOCK}>
          {block.text}
        </pre>
      );
    case 'quote':
      return (
        <blockquote
          key={key}
          className="m-0 border-l-2 border-bf-border-strong pl-3 text-bf-md leading-5 text-bf-text-secondary"
        >
          {renderInline(block.children, key)}
        </blockquote>
      );
    case 'rule':
      return <hr key={key} className="m-0 border-0 border-t border-bf-border-subtle" />;
  }
}

export interface ReadmeTextProps {
  fileName: string;
  text: string;
  className?: string;
}

/**
 * README text. Markdown files go through the safe subset parser (text nodes
 * only: no HTML is interpreted, no image is loaded, no link is clickable);
 * `.rst`, `.txt` and anything else is shown as wrapped preformatted text.
 */
export const ReadmeText = React.memo(function ReadmeText({
  fileName,
  text,
  className,
}: ReadmeTextProps) {
  const markdown = isMarkdownFile(fileName);
  // Parsed and laid out once per text: the card re-renders for unrelated
  // reasons (a selected analysis, the raw JSON toggle), the README does not.
  const rendered = useMemo(
    () => (markdown ? parseMarkdown(text).map(renderBlock) : null),
    [markdown, text],
  );
  if (!rendered) {
    return (
      <pre
        data-readme-format="plain"
        className={cn(
          'm-0 whitespace-pre-wrap font-mono text-bf-xs leading-[18px] text-bf-text-primary [overflow-wrap:anywhere]',
          className,
        )}
      >
        {text}
      </pre>
    );
  }
  return (
    <div data-readme-format="markdown" className={cn('flex min-w-0 flex-col gap-2', className)}>
      {rendered}
    </div>
  );
});

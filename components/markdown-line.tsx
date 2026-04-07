"use client";

import type { ReactNode } from "react";

export function MarkdownLine({ text }: { text: string }) {
  if (!text) return <span>{"\u00A0"}</span>;

  const headingMatch = text.match(/^(#{1,4})\s(.+)/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const sizeClass = level === 1 ? "text-base" : level === 2 ? "text-[0.9375rem]" : "text-sm";
    return (
      <span className={`font-bold text-foreground ${sizeClass}`}>
        <span className="text-muted-foreground/40">{headingMatch[1]} </span>
        {headingMatch[2]}
      </span>
    );
  }

  if (text.match(/^```/)) {
    return <span className="text-muted-foreground/60 italic">{text}</span>;
  }

  if (text.match(/^\s*[-*]\s/)) {
    const idx = text.indexOf("- ") !== -1 ? text.indexOf("- ") : text.indexOf("* ");
    return (
      <span>
        <span className="text-muted-foreground/40">{text.slice(0, idx + 2)}</span>
        <InlineFormatted text={text.slice(idx + 2)} />
      </span>
    );
  }

  if (text.match(/^\s*\d+\.\s/)) {
    const idx = text.indexOf(". ") + 2;
    return (
      <span>
        <span className="text-muted-foreground/40">{text.slice(0, idx)}</span>
        <InlineFormatted text={text.slice(idx)} />
      </span>
    );
  }

  if (text.match(/^>\s/)) {
    return (
      <span className="text-muted-foreground italic">
        <span className="text-muted-foreground/40">{"> "}</span>
        {text.slice(2)}
      </span>
    );
  }

  return <InlineFormatted text={text} />;
}

function InlineFormatted({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(
        <span key={match.index} className="font-bold text-foreground">
          {token.slice(2, -2)}
        </span>
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <span key={match.index} className="text-foreground bg-muted px-1 rounded-sm">
          {token.slice(1, -1)}
        </span>
      );
    } else if (token.startsWith("*")) {
      parts.push(
        <span key={match.index} className="italic">
          {token.slice(1, -1)}
        </span>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span>{parts.length > 0 ? parts : text}</span>;
}

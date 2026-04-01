interface StreamingTextProps {
  text: string;
}

export function StreamingText({ text }: StreamingTextProps) {
  // TODO(T14): replace plain text rendering with streaming delta composition and markdown.
  return <pre className="whitespace-pre-wrap text-sm text-stone-100">{text}</pre>;
}

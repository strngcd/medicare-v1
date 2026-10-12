/**
 * Renders the small Markdown subset used by help articles: "## " headings,
 * "- " bullets, "1. " numbered lists and paragraphs. Content is rendered as
 * text (no HTML injection).
 */
export function HelpMarkdown({ text }) {
  const blocks = [];
  let list = null;
  const flush = () => {
    if (list) blocks.push(list);
    list = null;
  };
  text.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (!line) return flush();
    if (line.startsWith('## ')) {
      flush();
      blocks.push({ type: 'h', text: line.slice(3) });
    } else if (line.startsWith('- ') || /^\d+\.\s/.test(line)) {
      const ordered = !line.startsWith('- ');
      if (!list || list.ordered !== ordered) {
        flush();
        list = { type: 'list', ordered, items: [] };
      }
      list.items.push(line.replace(/^(- |\d+\.\s)/, ''));
    } else {
      flush();
      blocks.push({ type: 'p', text: line });
    }
  });
  flush();

  return (
    <div className="prose">
      {blocks.map((b, i) => {
        if (b.type === 'h') return <h2 key={i}>{b.text}</h2>;
        if (b.type === 'p') return <p key={i}>{b.text}</p>;
        const List = b.ordered ? 'ol' : 'ul';
        return <List key={i}>{b.items.map((item, j) => <li key={j}>{item}</li>)}</List>;
      })}
    </div>
  );
}

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export default function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="markdown-message" dir="auto">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          p: (props) => <p {...props} dir="auto" />,
          li: (props) => <li {...props} dir="auto" />,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

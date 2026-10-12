import { useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { PageHeader, Panel, ErrorState, SkeletonRows } from '../../components/ui/index.js';
import { HelpMarkdown } from '../../components/HelpMarkdown.jsx';

export default function HelpArticlePage() {
  const { slug } = useParams();
  const article = useApi(() => api.get(`/help/${slug}`).then((r) => r.data), [slug]);
  if (article.error) return <Panel><ErrorState error={article.error} onRetry={article.reload} /></Panel>;
  if (!article.data) return <Panel><SkeletonRows rows={8} columns={1} /></Panel>;
  const a = article.data;
  return (
    <div className="stack">
      <PageHeader title={a.title} description={a.summary} breadcrumbs={[{ label: 'Help center', to: '/help' }, { label: a.categoryLabel }]} />
      <Panel><HelpMarkdown text={a.body} /></Panel>
    </div>
  );
}

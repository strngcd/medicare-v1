import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui/index.js';

export default function NotFoundPage() {
  return <EmptyState icon={Compass} title="Page not found" message="The page you are looking for does not exist or has moved." action={<Link className="btn btn-primary" to="/">Go to start</Link>} />;
}

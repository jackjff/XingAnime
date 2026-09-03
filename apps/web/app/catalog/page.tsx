import { Suspense } from 'react';
import { CatalogClient } from '../components/catalog-client';

export default function CatalogPage() {
  return <Suspense fallback={<main className="app-page"><div className="page-shell"><div className="status-card">Memuat katalog...</div></div></main>}><CatalogClient /></Suspense>;
}

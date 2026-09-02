import { AnimeDetailClient } from '../../../components/anime-detail-client';

type PageProps = { params: Promise<{ source: string; slug: string }> };

export default async function AnimeDetailPage({ params }: PageProps) {
  const { source, slug } = await params;
  return <AnimeDetailClient source={source} slug={slug} />;
}

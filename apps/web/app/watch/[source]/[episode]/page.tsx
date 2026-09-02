import { WatchClient } from '../../../components/watch-client';

type PageProps = { params: Promise<{ source: string; episode: string }> };

export default async function WatchPage({ params }: PageProps) {
  const { source, episode } = await params;
  return <WatchClient source={source} episode={episode} />;
}

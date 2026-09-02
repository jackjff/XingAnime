'use client';

import { useEffect, useState } from 'react';

type PosterImageProps = {
  src: string | null;
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
};

const fallbackPoster = '/poster-fallback.svg';

export function PosterImage({ src, alt, className, loading = 'lazy' }: PosterImageProps) {
  const [currentSrc, setCurrentSrc] = useState(src ?? fallbackPoster);

  useEffect(() => {
    setCurrentSrc(src ?? fallbackPoster);
  }, [src]);

  return (
    <img
      className={className}
      src={currentSrc}
      alt={alt}
      loading={loading}
      onError={() => setCurrentSrc(fallbackPoster)}
    />
  );
}

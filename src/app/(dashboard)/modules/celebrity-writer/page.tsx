'use client';

import { CelebrityWriterView } from '@/components/modules/celebrity-writer-view';
import { celebrityWriterManifest } from '@/modules/celebrity-writer/manifest';

export default function CelebrityWriterPage() {
  return (
    <CelebrityWriterView
      manifest={celebrityWriterManifest}
      title="Celebrity Article Writer"
      description="Module #1 — ChatGPT (browser) researches and writes the article, then it is saved as a WordPress draft with Rank Math fields."
    />
  );
}

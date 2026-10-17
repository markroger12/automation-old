'use client';

import { CelebrityWriterView } from '@/components/modules/celebrity-writer-view';
import { celebrityWriter2Manifest } from '@/modules/celebrity-writer-2/manifest';

export default function CelebrityWriter2Page() {
  return (
    <CelebrityWriterView
      manifest={celebrityWriter2Manifest}
      keywordOnly
      title="Celebrity Writer 2.0"
      description="Only the keyword goes into the prompt: ChatGPT (browser) verifies who the person is, finds the title itself, and researches and writes the whole biography in one answer — Quick Bio, FAQs, meta description, slug and tags. It is saved as a WordPress draft; research notes are kept in the task log."
    />
  );
}

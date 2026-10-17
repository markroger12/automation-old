import { notFound } from 'next/navigation';
import { Construction } from 'lucide-react';
import { getModule } from '@/modules/registry';
import { Card } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/feedback';
import { LinkButton } from '@/components/ui/button';

export default async function ModulePlaceholderPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const manifest = getModule(key);
  if (!manifest) notFound();

  return (
    <>
      <PageHeader title={manifest.name} description={manifest.description} />
      <Card>
        <EmptyState
          icon={<Construction className="h-10 w-10" />}
          title="This module is planned"
          description="The dashboard, queue, browser engine, prompt manager and SEO checker are shared, so new modules only need a manifest, prompts, a pipeline and a page. See docs/ADDING_MODULES.md."
          action={<LinkButton href="/modules/celebrity-writer">Open Celebrity Article Writer</LinkButton>}
        />
      </Card>
    </>
  );
}

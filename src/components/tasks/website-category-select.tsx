'use client';

import { useEffect } from 'react';
import type { WebsiteItem } from '@/lib/client/types';
import { Field, Select } from '@/components/ui/form';

/** Website + category pickers. Categories are the local list saved for the selected website. */
export function WebsiteCategorySelect({
  websites,
  websiteId,
  categoryId,
  onChange,
}: {
  websites: WebsiteItem[];
  websiteId: string;
  categoryId: string;
  onChange: (value: { websiteId: string; categoryId: string }) => void;
}) {
  const website = websites.find((w) => w.id === websiteId);

  useEffect(() => {
    if (website && !categoryId && website.defaultCategoryId) {
      onChange({ websiteId, categoryId: website.defaultCategoryId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteId]);

  return (
    <>
      <Field label="Website" htmlFor="website" hint={websites.length === 0 ? 'Add a website on the Websites page first.' : undefined}>
        <Select id="website" value={websiteId} onChange={(e) => onChange({ websiteId: e.target.value, categoryId: '' })}>
          <option value="">— No website (generate only) —</option>
          {websites
            .filter((w) => w.isActive)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field
        label="Category"
        htmlFor="category"
        hint={website && website.categories.length === 0 ? 'No categories saved for this website yet — add them on the Websites page.' : undefined}
      >
        <Select id="category" value={categoryId} disabled={!website} onChange={(e) => onChange({ websiteId, categoryId: e.target.value })}>
          <option value="">— Select category —</option>
          {website?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

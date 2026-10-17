'use client';

import { useState, type FormEvent } from 'react';
import { Bot, ExternalLink, Globe, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { apiFetch, useApi, waitForControlJob } from '@/lib/client/api';
import type { ProfileItem, WebsiteItem } from '@/lib/client/types';
import { websiteLanguage } from '@/lib/content-locale';
import { timeAgo } from '@/lib/utils';
import { Badge, SessionBadge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Spinner } from '@/components/ui/feedback';
import { Field, Input, Select, Toggle } from '@/components/ui/form';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ProfileActionButtons, useProfileAction } from '@/components/sessions/profile-actions';

interface WebsiteForm {
  name: string;
  url: string;
  adminUrl: string;
  profileId: string;
  defaultAuthor: string;
  editorType: 'AUTO' | 'GUTENBERG' | 'CLASSIC';
  isActive: boolean;
  internalLinkLine: string;
  tigramImages: boolean;
  accentColour: string;
  logoPosition: 'bottom-right' | 'bottom-left' | 'bottom-center' | 'top-right' | 'top-left';
  featuredStyle: 'split' | 'single';
}

const emptyForm: WebsiteForm = {
  name: '',
  url: '',
  adminUrl: '',
  profileId: '__new__',
  defaultAuthor: '',
  editorType: 'AUTO',
  isActive: true,
  internalLinkLine: '',
  tigramImages: true,
  accentColour: '',
  logoPosition: 'bottom-right',
  featuredStyle: 'single',
};

function internalLinkExample(url: string): string {
  return websiteLanguage(url)?.language === 'German' ? 'Das könnte Ihnen gefallen:' : 'You may also like:';
}

function WebsiteModal({
  open,
  onClose,
  website,
  profiles,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  website: WebsiteItem | null;
  profiles: ProfileItem[];
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<WebsiteForm>(
    website
      ? {
          name: website.name,
          url: website.url,
          adminUrl: website.adminUrl,
          profileId: website.profileId ?? '',
          defaultAuthor: website.defaultAuthor ?? '',
          editorType: website.editorType,
          isActive: website.isActive,
          internalLinkLine: website.internalLinkLine ?? '',
          tigramImages: website.tigramImages,
          accentColour: website.accentColour ?? '',
          logoPosition: website.logoPosition ?? 'bottom-right',
          featuredStyle: website.featuredStyle ?? 'single',
        }
      : emptyForm,
  );
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof WebsiteForm>(k: K, v: WebsiteForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        name: form.name,
        url: form.url,
        adminUrl: form.adminUrl,
        profileId: form.profileId === '__new__' ? null : form.profileId || null,
        defaultAuthor: form.defaultAuthor || null,
        editorType: form.editorType,
        isActive: form.isActive,
        internalLinkLine: form.internalLinkLine.trim(),
        tigramImages: form.tigramImages,
        accentColour: form.accentColour.trim() || null,
        logoPosition: form.logoPosition,
        featuredStyle: form.featuredStyle,
      };
      if (website) await apiFetch(`/api/websites/${website.id}`, { method: 'PATCH', body });
      else await apiFetch('/api/websites', { method: 'POST', body: { ...body, createProfile: form.profileId === '__new__' } });
      toast.success(website ? 'Website updated' : 'Website added', website ? undefined : 'Next: add categories and log in with the browser profile.');
      onSaved();
      onClose();
    } catch (err) {
      toast.error('Could not save website', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const wpProfiles = profiles;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={website ? 'Edit website' : 'Add WordPress website'}
      description="No WordPress API credentials or Application Passwords — authentication uses the saved browser login."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="website-form" loading={saving}>
            {website ? 'Save changes' : 'Add website'}
          </Button>
        </>
      }
    >
      <form id="website-form" onSubmit={submit} className="space-y-4">
        <Field label="Website Name" htmlFor="w-name" required>
          <Input id="w-name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="My Celebrity Blog" />
        </Field>
        <Field label="Website URL" htmlFor="w-url" required>
          <Input id="w-url" type="url" required value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com" />
        </Field>
        <Field label="WordPress Admin URL" htmlFor="w-admin" hint="Leave empty to use {website}/wp-admin/">
          <Input id="w-admin" type="url" value={form.adminUrl} onChange={(e) => set('adminUrl', e.target.value)} placeholder="https://example.com/wp-admin/" />
        </Field>
        <Field
          label="Internal link line"
          htmlFor="w-internal-link"
          hint="Added as the last line of every article, followed by a link to the previous article written for this website. Each website can use its own text. Leave empty for no internal link."
        >
          <Input
            id="w-internal-link"
            maxLength={150}
            value={form.internalLinkLine}
            onChange={(e) => set('internalLinkLine', e.target.value)}
            placeholder={`e.g. ${internalLinkExample(form.url)}`}
          />
        </Field>
        <Field label="Browser Profile" htmlFor="w-profile" hint="Each website can keep its own logged-in browser profile.">
          <Select id="w-profile" value={form.profileId} onChange={(e) => set('profileId', e.target.value)}>
            {!website && <option value="__new__">Create a new profile for this website</option>}
            {website && <option value="">— No profile —</option>}
            {wpProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.websites.length ? ` (used by ${p.websites.map((w) => w.name).join(', ')})` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default Author" htmlFor="w-author" hint="Optional, for your reference">
            <Input id="w-author" value={form.defaultAuthor} onChange={(e) => set('defaultAuthor', e.target.value)} />
          </Field>
          <Field label="Editor" htmlFor="w-editor">
            <Select id="w-editor" value={form.editorType} onChange={(e) => set('editorType', e.target.value as WebsiteForm['editorType'])}>
              <option value="AUTO">Detect automatically</option>
              <option value="GUTENBERG">Block editor (Gutenberg)</option>
              <option value="CLASSIC">Classic editor</option>
            </Select>
          </Field>
        </div>
        <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <Toggle
            checked={form.tigramImages}
            onChange={(v) => set('tigramImages', v)}
            label="Create images for Tigram articles"
            description="Off: the Tigram articles of this website are written without any images."
          />
          {form.tigramImages && (
            <>
              <Field
                label="Featured image"
                htmlFor="w-featured"
                hint="Two pictures: the line and the logo sit between them, like the Peak Buzz template."
              >
                <Select id="w-featured" value={form.featuredStyle} onChange={(e) => set('featuredStyle', e.target.value as WebsiteForm['featuredStyle'])}>
                  <option value="single">One picture, logo in a corner</option>
                  <option value="split">Two pictures with the line between them</option>
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Line colour" htmlFor="w-accent" hint="Like #0179DE. Empty: taken from the logo.">
                  <Input id="w-accent" value={form.accentColour} onChange={(e) => set('accentColour', e.target.value)} placeholder="#0179DE" />
                </Field>
                <Field label="Logo place" htmlFor="w-logopos" hint="Used when one photo fills the image.">
                  <Select id="w-logopos" value={form.logoPosition} onChange={(e) => set('logoPosition', e.target.value as WebsiteForm['logoPosition'])}>
                    <option value="bottom-right">Bottom right</option>
                    <option value="bottom-left">Bottom left</option>
                    <option value="bottom-center">Bottom middle</option>
                    <option value="top-right">Top right</option>
                    <option value="top-left">Top left</option>
                  </Select>
                </Field>
              </div>
              {website ? (
                <LogoField website={website} onChanged={onSaved} />
              ) : (
                <p className="text-xs text-slate-500">Add the website first, then its logo can be uploaded here.</p>
              )}
            </>
          )}
        </div>
        {website && <Toggle checked={form.isActive} onChange={(v) => set('isActive', v)} label="Active" description="Inactive websites are hidden from the article form." />}
      </form>
    </Modal>
  );
}

/** Uploads the logo that goes on this website's article images, or removes it again. */
function LogoField({ website, onChanged }: { website: WebsiteItem; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [logo, setLogo] = useState<string | null>(website.logoFile);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append('logo', file);
      // apiFetch sends the session and the CSRF token the app expects.
      const data = await apiFetch<{ website: WebsiteItem }>(`/api/websites/${website.id}/logo`, { method: 'POST', formData: body });
      setLogo(data.website.logoFile);
      toast.success('Logo saved', 'New article images of this website carry it.');
      onChanged();
    } catch (err) {
      toast.error('Could not save the logo', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/websites/${website.id}/logo`, { method: 'DELETE' });
      setLogo(null);
      toast.success('Logo removed', 'The images of this website carry no logo now.');
      onChanged();
    } catch (err) {
      toast.error('Could not remove the logo', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field label="Logo" htmlFor="w-logo" hint="PNG with a transparent background works best. It sits on the images, 226 px high.">
      <div className="flex flex-wrap items-center gap-3">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/websites/${website.id}/logo/file?v=${encodeURIComponent(logo)}`} alt="" className="h-12 w-auto rounded border border-slate-200 bg-white p-1" />
        ) : (
          <span className="text-sm text-slate-500">No logo yet</span>
        )}
        <input
          id="w-logo"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          disabled={busy}
          onChange={(e) => void upload(e.target.files?.[0])}
          className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-slate-700"
        />
        {logo && (
          <Button type="button" variant="outline" onClick={() => void remove()} loading={busy}>
            Remove
          </Button>
        )}
      </div>
    </Field>
  );
}

function CategoryManager({ website, onChanged }: { website: WebsiteItem; onChanged: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const sync = useProfileAction(onChanged);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`/api/websites/${website.id}/categories`, { method: 'POST', body: { names: value } });
      setValue('');
      onChanged();
    } catch (err) {
      toast.error('Could not add categories', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = async (id: string, name: string) => {
    if (!window.confirm(`Remove "${name}" from the local category list? (Nothing changes in WordPress.)`)) return;
    try {
      await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      toast.error('Could not remove category', (err as Error).message);
    }
  };

  const setDefault = async (categoryId: string) => {
    try {
      await apiFetch(`/api/websites/${website.id}`, { method: 'PATCH', body: { defaultCategoryId: categoryId || null } });
      onChanged();
    } catch (err) {
      toast.error('Could not set default category', (err as Error).message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {website.categories.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pr-1 pl-2.5 text-xs font-medium text-slate-700">
            {c.name}
            {website.defaultCategoryId === c.id && <Badge tone="indigo" className="py-0">default</Badge>}
            <button type="button" onClick={() => removeCategory(c.id, c.name)} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label={`Remove ${c.name}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {website.categories.length === 0 && (
          <span className="text-xs text-slate-500">No categories yet — they are read from WordPress after &quot;Test Session&quot;, or click &quot;Sync from WordPress&quot;.</span>
        )}
      </div>
      {website.profileId && (
        <Button
          size="xs"
          variant="outline"
          icon={<RefreshCw className="h-3.5 w-3.5" />}
          loading={sync.busy === `${website.profileId}:sync-categories`}
          onClick={() => sync.run(website.profileId!, 'sync-categories', website.id)}
        >
          Sync from WordPress
        </Button>
      )}
      <form onSubmit={add} className="flex gap-2">
        <Input className="h-8" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Celebrities, Actors, Actresses, Musicians…" />
        <Button type="submit" size="sm" variant="outline" loading={busy} icon={<Plus className="h-3.5 w-3.5" />}>
          Add
        </Button>
      </form>
      {website.categories.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Default category</span>
          <Select className="h-8 max-w-xs py-1 text-xs" value={website.defaultCategoryId ?? ''} onChange={(e) => setDefault(e.target.value)}>
            <option value="">— None —</option>
            {website.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}

export default function WebsitesPage() {
  const toast = useToast();
  const websites = useApi<{ websites: WebsiteItem[] }>('/api/websites', { refreshInterval: 10000 });
  const profiles = useApi<{ profiles: ProfileItem[] }>('/api/profiles', { refreshInterval: 10000 });
  const [modal, setModal] = useState<{ open: boolean; website: WebsiteItem | null }>({ open: false, website: null });
  const reload = () => {
    void websites.reload();
    void profiles.reload();
  };

  const deleteWebsite = async (w: WebsiteItem) => {
    if (!window.confirm(`Delete website "${w.name}" and its local categories? Articles are kept. The browser profile is kept.`)) return;
    try {
      await apiFetch(`/api/websites/${w.id}`, { method: 'DELETE' });
      toast.success('Website deleted');
      reload();
    } catch (err) {
      toast.error('Delete failed', (err as Error).message);
    }
  };

  const deleteProfile = async (p: ProfileItem) => {
    if (!window.confirm(`Delete browser profile "${p.name}" including its cookies and saved login?`)) return;
    try {
      const { jobId } = await apiFetch<{ jobId: string }>(`/api/profiles/${p.id}`, { method: 'DELETE' });
      const status = await waitForControlJob(jobId);
      if (status.state === 'completed') toast.success('Browser profile deleted');
      else toast.error('Delete failed', status.error ?? 'Unknown error');
    } catch (err) {
      toast.error('Delete failed', (err as Error).message);
    } finally {
      reload();
    }
  };

  return (
    <>
      <PageHeader
        title="Websites"
        description="WordPress sites, their local category lists and the persistent browser sessions used for automation."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setModal({ open: true, website: null })}>
            Add Website
          </Button>
        }
      />

      <Alert tone="info" title="How logins work" className="mb-6">
        Click <strong>Login</strong> to open a Chrome window for that profile. Sign in yourself (including any 2FA), then{' '}
        <strong>close that window</strong> and click <strong>Test Session</strong>. Cookies stay in that browser profile, so you only log in once. Passwords are never stored by this app.
      </Alert>

      <Card className="mb-6">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-emerald-600" /> ChatGPT
            </span>
          }
          description="Every article is written through the ChatGPT Worker extension in your own Chrome"
          actions={<LinkButton href="/settings" size="xs">Extension settings</LinkButton>}
        />
        <CardBody>
          <p className="text-sm text-slate-600">
            Log in to ChatGPT yourself in the Chrome profile that has the extension. The extension opens ChatGPT tabs by itself when articles
            are queued; its connection status is shown under Settings → ChatGPT Chrome extension.
          </p>
        </CardBody>
      </Card>

      {websites.loading && !websites.data ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Spinner />
        </div>
      ) : !websites.data?.websites.length ? (
        <Card>
          <EmptyState
            icon={<Globe className="h-8 w-8" />}
            title="No websites yet"
            description="Add your WordPress site. A dedicated browser profile is created for it automatically."
            action={<Button onClick={() => setModal({ open: true, website: null })}>Add Website</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {websites.data.websites.map((w) => (
            <Card key={w.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    {w.name}
                    {!w.isActive && <Badge>inactive</Badge>}
                  </span>
                }
                description={
                  <a href={w.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-indigo-600">
                    {w.url} <ExternalLink className="h-3 w-3" />
                  </a>
                }
                actions={
                  <>
                    <Button size="xs" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setModal({ open: true, website: w })}>
                      Edit
                    </Button>
                    <Button size="xs" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => deleteWebsite(w)}>
                      Delete
                    </Button>
                  </>
                }
              />
              <CardBody className="space-y-5">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Admin URL</dt>
                    <dd className="truncate text-slate-800">{w.adminUrl}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Editor</dt>
                    <dd className="text-slate-800">{w.editorType === 'AUTO' ? 'Auto-detect' : w.editorType === 'GUTENBERG' ? 'Block editor' : 'Classic editor'}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Browser profile</dt>
                    <dd className="flex items-center gap-2 text-slate-800">
                      {w.profile ? (
                        <>
                          <span className="truncate">{w.profile.name}</span>
                          <SessionBadge status={w.profile.sessionStatus} />
                        </>
                      ) : (
                        <span className="text-amber-600">None assigned</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Articles</dt>
                    <dd className="text-slate-800">
                      {w._count.tasks}
                      {w.defaultAuthor ? ` · author: ${w.defaultAuthor}` : ''}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Internal link line</dt>
                    <dd className="truncate text-slate-800">
                      {w.internalLinkLine ? `${w.internalLinkLine} → previous article` : <span className="text-slate-500">Not set — no internal link</span>}
                    </dd>
                  </div>
                </dl>

                {w.profile ? (
                  <div>
                    <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">WordPress session</p>
                    <ProfileActionButtons profileId={w.profile.id} kind={w.profile.kind} websiteId={w.id} onDone={reload} compact />
                    {w.profile.sessionDetail && <p className="mt-2 text-xs text-slate-500">{w.profile.sessionDetail}</p>}
                  </div>
                ) : (
                  <Alert tone="warning">Assign a browser profile (Edit) so the automation can log in to this site.</Alert>
                )}

                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Categories (from WordPress)</p>
                  <CategoryManager website={w} onChanged={reload} />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader title="Browser Profiles" description="Persistent Chrome profiles (cookies and saved sessions) stored in DATA_DIR/profiles" />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50/70 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-5 py-3">Profile</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Used by</th>
                <th className="px-5 py-3">Session</th>
                <th className="px-5 py-3">Last checked</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {profiles.data?.profiles.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3 font-medium text-slate-800">{p.name}</td>
                  <td className="px-5 py-3 text-slate-600">WordPress</td>
                  <td className="px-5 py-3 text-slate-600">{p.websites.map((x) => x.name).join(', ') || '—'}</td>
                  <td className="px-5 py-3">
                    <SessionBadge status={p.sessionStatus} />
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-500">{p.lastCheckedAt ? timeAgo(p.lastCheckedAt) : '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <Button size="xs" variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => deleteProfile(p)}>
                      Delete profile
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {modal.open && (
        <WebsiteModal open website={modal.website} profiles={profiles.data?.profiles ?? []} onClose={() => setModal({ open: false, website: null })} onSaved={reload} />
      )}
    </>
  );
}

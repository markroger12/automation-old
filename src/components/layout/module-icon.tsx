import { Layers, Link2, MapPin, Newspaper, Package, PenLine, Search, ShieldCheck, Star } from 'lucide-react';
import type { ModuleIconName } from '@/modules/types';

const ICONS = {
  star: Star,
  pen: PenLine,
  'map-pin': MapPin,
  package: Package,
  newspaper: Newspaper,
  search: Search,
  link: Link2,
  shield: ShieldCheck,
  layers: Layers,
} satisfies Record<ModuleIconName, unknown>;

export function ModuleIcon({ name, className }: { name: ModuleIconName; className?: string }) {
  const Icon = ICONS[name] ?? Layers;
  return <Icon className={className ?? 'h-4 w-4'} />;
}

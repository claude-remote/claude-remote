import type { SessionMeta } from '@/shared/types';

interface CwdPickerProps {
  cwd: string;
  favorites: Array<{ id: string; label: string; path: string }>;
  session?: Pick<SessionMeta, 'id'>;
}

export function CwdPicker({ cwd, favorites }: CwdPickerProps) {
  // TODO(T17): add favorites, filesystem tree navigation, and secure path switching.
  return (
    <section className="rounded border border-stone-800 p-3">
      <p className="text-sm text-stone-400">当前目录</p>
      <p className="font-medium">{cwd}</p>
      <ul className="mt-2 space-y-1 text-sm text-stone-300">
        {favorites.map((favorite) => (
          <li key={favorite.id}>{favorite.label}</li>
        ))}
      </ul>
    </section>
  );
}

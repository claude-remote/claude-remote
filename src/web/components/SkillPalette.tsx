import type { SkillInfo } from '@/shared/types';

interface SkillPaletteProps {
  skills: SkillInfo[];
}

export function SkillPalette({ skills }: SkillPaletteProps) {
  // TODO(T18): implement slash-triggered fuzzy search and argument hinting.
  return (
    <section className="rounded border border-stone-800 p-3">
      <p className="text-sm text-stone-400">Skills</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {skills.map((skill) => (
          <span key={skill.name} className="rounded bg-stone-800 px-2 py-1 text-xs">
            /{skill.name}
          </span>
        ))}
      </div>
    </section>
  );
}

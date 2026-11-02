export interface CommandPaletteCommand {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  shortcut?: string;
  group?: string;
  /** A heading in a sectioned palette (the BIDS browser's go-to). */
  section?: string;
  /** A short tag after the title, such as a run's FD. */
  badge?: string;
  /** Right-aligned text in place of the shortcut or group. */
  hint?: string;
  /** Enter runs. */
  run: () => void | Promise<void>;
  /** Tab and click go here when present: choose without running. */
  select?: () => void;
}

/** Rows per section: a dataset of 10k runs ranks them all and draws these. */
export const PALETTE_SECTION_LIMIT = 6;
const DEFAULT_SECTION = 'Commands';

export interface PaletteView {
  /** What is on screen, in order; arrow keys move through this. */
  visible: CommandPaletteCommand[];
  /** Index in `visible` where each section starts, with what it left out. */
  sections: Map<number, { title: string }>;
  /** Index of the last row of a capped section, with how many are hidden. */
  hidden: Map<number, number>;
}

/** Ranked commands as they are drawn: by section, each capped, when any has one. */
export function paletteView(ranked: CommandPaletteCommand[], sectioned: boolean): PaletteView {
  if (!sectioned) return { visible: ranked, sections: new Map(), hidden: new Map() };
  const bySection = new Map<string, CommandPaletteCommand[]>();
  for (const command of ranked) {
    const title = command.section ?? DEFAULT_SECTION;
    const own = bySection.get(title);
    if (own) own.push(command);
    else bySection.set(title, [command]);
  }
  const visible: CommandPaletteCommand[] = [];
  const sections = new Map<number, { title: string }>();
  const hidden = new Map<number, number>();
  for (const [title, own] of bySection) {
    sections.set(visible.length, { title });
    visible.push(...own.slice(0, PALETTE_SECTION_LIMIT));
    if (own.length > PALETTE_SECTION_LIMIT) {
      hidden.set(visible.length - 1, own.length - PALETTE_SECTION_LIMIT);
    }
  }
  return { visible, sections, hidden };
}

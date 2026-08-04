/**
 * Boss pre-fight dialogue (client-only flavor — never affects rules).
 *
 * Keyed by the server's boss npc `id` (SpaceEvent.npc.id). On a Vestige
 * re-fight the id is unchanged (e.g. 'ishkanah'); only the display name gets
 * the "Vestige of …" prefix — see undercity_db.py:4344 and board-tab's
 * isVestigeFoe(). So the caller keys by id and passes the vestige flag to pick
 * the variant.
 *
 * Scope (design 2026-08-04): the five Guild-Sigil biome-lair bosses (intro +
 * vestige) and Savra (intro only — the one-time finale has no Vestige). The
 * two respawn/ruin lairs (Lord of Extinction, Doomgape), the Moor-Wyrm world
 * boss, and elites are intentionally excluded.
 *
 * No emojis, per project convention (Undercity uses its own symbol language).
 * Italic stage directions in plain text are fine.
 */
export interface BossDialogue {
  /** Spoken on the first / true-boss encounter. One or two short beats. */
  intro: string[];
  /** Spoken when the foe is the reformed Vestige. Omit for bosses with no
   *  Vestige (Savra). */
  vestige?: string[];
}

export const BOSS_DIALOGUE: Record<string, BossDialogue> = {
  ishkanah: {
    intro: [
      'Little morsel, you have wandered into my web. My daughters are so hungry — and you look delicious.',
    ],
    vestige: [
      'You cut me down once, little morsel. But a web has a thousand threads, and I still remember your taste.',
    ],
  },
  sarulf: {
    intro: [
      'I have swallowed whole realms, whelp. What is one more scrap of meat to the maw of the end?',
    ],
    vestige: [
      'You laid me low, and still I gnaw at the edge of things. Dying only left me hungrier for you.',
    ],
  },
  gitrog_monster: {
    intro: [
      'A wet, rumbling croak. The bog takes all things, small one. Sink. Sink down into the muck with the rest.',
    ],
    vestige: [
      'You dredged me up from the dark once. The mire always coughs me back — and it never forgives a debt.',
    ],
  },
  skullbriar: {
    intro: [
      'Every step I take, I grow. Every grave I pass, I feed. Hold still — you will make fine soil.',
    ],
    vestige: [
      'You buried me. Foolish. A grave is where I grow strongest — see how much larger I have become.',
    ],
  },
  slimefoot: {
    intro: [
      'We are many. We are patient. We will bloom from the husk you leave behind.',
    ],
    vestige: [
      'You scattered us before, little host. But spores drift, and spores return. We have been waiting.',
    ],
  },
  rot_sovereign: {
    intro: [
      'So — a subject climbs to my throne uninvited.',
      'Kneel, or be composted with the rest of my garden.',
    ],
  },
};

/**
 * Lines a boss should speak before the fight, or null if this foe has no
 * dialogue (the common case: wild/elite/barrier/respawn-lair/world foes — the
 * caller uses null to skip the interstitial entirely).
 *
 * @param npcId  SpaceEvent.npc.id
 * @param vestige result of isVestigeFoe(npc.name)
 */
export function bossLines(npcId: string | undefined, vestige: boolean): string[] | null {
  if (!npcId) return null;
  const d = BOSS_DIALOGUE[npcId];
  if (!d) return null;
  if (vestige) return d.vestige ?? null;
  return d.intro;
}

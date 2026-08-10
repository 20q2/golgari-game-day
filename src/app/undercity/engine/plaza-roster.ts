/**
 * Adapter: the public roster the server sends -> the shape PlazaCanvas draws.
 *
 * Shared so the live plaza tab and the /tv after-hours plaza build their
 * creatures identically — a cosmetic added to one is never missing from the
 * other. Pure function, no Angular.
 */
import { PlazaCreature } from './plaza-canvas';
import { PublicPlayer, evolveGlowActive, isShielded } from '../services/undercity-models';

export function toPlazaCreature(p: PublicPlayer): PlazaCreature {
  return {
    userId: p.userId,
    username: p.username,
    form: p.form,
    spriteVariant: p.spriteVariant,
    formName: p.formName,
    creatureName: p.creatureName,
    level: p.level,
    paint: p.paint ?? {},
    hat: p.hat,
    shiny: p.shiny,
    effect: p.effect,
    shielded: isShielded(p),
    evolveGlow: evolveGlowActive(p as { evolvedAt?: string }),
    status: p.status ?? '',
    pokedRecently: p.pokedRecently ?? false,
    pokeCooldownUntil: p.pokeCooldownUntil ?? null,
  };
}

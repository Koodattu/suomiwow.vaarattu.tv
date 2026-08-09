import type { FunGameRound, FunGameSlug } from "./fun-game.types";
import { generateGuildGuessrRound } from "./generators/guild-guessr";
import { generateImmaculateRosterRound } from "./generators/immaculate-roster";
import { generateLockItInRound } from "./generators/lock-it-in";
import { generateRaidConnectionsRound } from "./generators/raid-connections";
import { generateRaiderResumeRound } from "./generators/raider-resume";
import { generateWipeprintRound } from "./generators/wipeprint";
import { generateSuomidleRound } from "./generators/suomidle";
import { generateHigherOrWipeRound } from "./generators/higher-or-wipe";
import { generateClosestWithoutGoingOverRound } from "./generators/closest-without-going-over";

export async function generateFunGameRound(game: FunGameSlug): Promise<FunGameRound> {
  switch (game) {
    case "immaculate-roster":
      return generateImmaculateRosterRound();
    case "guild-guessr":
      return generateGuildGuessrRound();
    case "wipeprint":
      return generateWipeprintRound();
    case "raider-resume":
      return generateRaiderResumeRound();
    case "raid-connections":
      return generateRaidConnectionsRound();
    case "lock-it-in":
      return generateLockItInRound();
    case "suomidle":
      return generateSuomidleRound();
    case "higher-or-wipe":
      return generateHigherOrWipeRound();
    case "closest-without-going-over":
      return generateClosestWithoutGoingOverRound();
  }
}

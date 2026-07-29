import mongoose from "mongoose";
import Character from "../models/Character";

export type ObservedCharacterIdentityUpdate = {
  name: string;
  realm: string;
  region: string;
};

const EARLIEST_OBSERVED_AT = new Date(0);

export function buildObservedIdentityGuard(observedAt: Date): Record<string, unknown> {
  return {
    $expr: {
      $lte: [
        {
          $ifNull: ["$identityObservedAt", { $ifNull: ["$lastReportSeenAt", EARLIEST_OBSERVED_AT] }],
        },
        observedAt,
      ],
    },
  };
}

export async function updateCharacterIdentityFromObservation(
  characterId: mongoose.Types.ObjectId,
  identity: ObservedCharacterIdentityUpdate,
  observedAt: Date,
): Promise<boolean> {
  const result = await Character.updateOne(
    {
      _id: characterId,
      ...buildObservedIdentityGuard(observedAt),
    },
    {
      $set: {
        name: identity.name,
        realm: identity.realm,
        region: identity.region,
        identityObservedAt: observedAt,
      },
    },
  );

  return result.modifiedCount > 0;
}

import { Types } from "mongoose";
import { PICK_EM_RWF_GUILDS } from "../config/guilds";
import Guild from "../models/Guild";
import { IPickem } from "../models/Pickem";
import User, { IPickemPrediction } from "../models/User";

export type PickemSubmissionErrorCode =
  | "PICKEM_NOT_FOUND"
  | "PICKEM_FINALIZED"
  | "VOTING_NOT_OPEN"
  | "INVALID_PREDICTIONS"
  | "PICKEM_ALREADY_SUBMITTED";

export class PickemSubmissionError extends Error {
  constructor(
    public readonly code: PickemSubmissionErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PickemSubmissionError";
  }
}

export function assertPickemAcceptingPredictions(
  pickem: Pick<IPickem, "active" | "finalized" | "votingStart" | "votingEnd"> | null,
  now = new Date(),
): asserts pickem is Pick<IPickem, "active" | "finalized" | "votingStart" | "votingEnd"> {
  if (!pickem?.active) {
    throw new PickemSubmissionError("PICKEM_NOT_FOUND", 404, "Pickem not found");
  }

  if (pickem.finalized) {
    throw new PickemSubmissionError("PICKEM_FINALIZED", 409, "Voting is closed for this pickem");
  }

  if (now < new Date(pickem.votingStart) || now > new Date(pickem.votingEnd)) {
    throw new PickemSubmissionError("VOTING_NOT_OPEN", 409, "Voting is not open for this pickem");
  }
}

export async function validatePickemPredictions(
  pickem: Pick<IPickem, "type" | "guildCount">,
  value: unknown,
): Promise<IPickemPrediction[]> {
  const pickemType = pickem.type || "regular";
  const guildCount = pickem.guildCount || 10;

  if (!Array.isArray(value) || value.length !== guildCount) {
    throw new PickemSubmissionError("INVALID_PREDICTIONS", 400, `Must provide exactly ${guildCount} predictions`);
  }

  const predictions: IPickemPrediction[] = [];
  const positions = new Set<number>();
  const guildKeys = new Set<string>();

  for (const valuePrediction of value) {
    if (!valuePrediction || typeof valuePrediction !== "object" || Array.isArray(valuePrediction)) {
      throw new PickemSubmissionError("INVALID_PREDICTIONS", 400, "Invalid prediction data");
    }

    const rawPrediction = valuePrediction as Record<string, unknown>;
    if (typeof rawPrediction.guildName !== "string" || typeof rawPrediction.realm !== "string" || !Number.isInteger(rawPrediction.position)) {
      throw new PickemSubmissionError("INVALID_PREDICTIONS", 400, "Each prediction must have a guild name, realm, and integer position");
    }

    const guildName = rawPrediction.guildName.trim();
    const realm = rawPrediction.realm.trim();
    const position = rawPrediction.position as number;

    if (guildName.length === 0 || guildName.length > 100 || realm.length === 0 || realm.length > 100) {
      throw new PickemSubmissionError("INVALID_PREDICTIONS", 400, "Invalid guild name or realm length");
    }

    if (position < 1 || position > guildCount || positions.has(position)) {
      throw new PickemSubmissionError("INVALID_PREDICTIONS", 400, `Positions must be unique integers between 1 and ${guildCount}`);
    }
    positions.add(position);

    const guildKey = `${guildName}\u0000${realm}`;
    if (guildKeys.has(guildKey)) {
      throw new PickemSubmissionError("INVALID_PREDICTIONS", 400, "Each guild must be unique in your predictions");
    }
    guildKeys.add(guildKey);

    predictions.push({ guildName, realm, position });
  }

  if (pickemType === "rwf") {
    for (const prediction of predictions) {
      if (!PICK_EM_RWF_GUILDS.includes(prediction.guildName) || prediction.realm !== "RWF") {
        throw new PickemSubmissionError("INVALID_PREDICTIONS", 400, `"${prediction.guildName}" is not a valid RWF guild`);
      }
    }
    return predictions;
  }

  const guildQueries = predictions.map((prediction) => ({ name: prediction.guildName, realm: prediction.realm }));
  const foundGuilds = await Guild.find({ $or: guildQueries }, { name: 1, realm: 1, parent_guild: 1 }).lean();
  const foundGuildMap = new Map(foundGuilds.map((guild) => [`${guild.name}\u0000${guild.realm}`, guild]));

  for (const prediction of predictions) {
    const guild = foundGuildMap.get(`${prediction.guildName}\u0000${prediction.realm}`);
    if (!guild) {
      throw new PickemSubmissionError("INVALID_PREDICTIONS", 400, `Guild "${prediction.guildName}" on "${prediction.realm}" not found`);
    }
    if (guild.parent_guild) {
      throw new PickemSubmissionError("INVALID_PREDICTIONS", 400, `Guild "${prediction.guildName}" is a sub-guild of "${guild.parent_guild}"`);
    }
  }

  return predictions;
}

export async function createGuestPickemEntryIfAbsent(
  userId: Types.ObjectId | string,
  pickemId: string,
  predictions: IPickemPrediction[],
  acceptedAt: Date,
): Promise<boolean> {
  const result = await User.updateOne(
    {
      _id: userId,
      "pickems.pickemId": { $ne: pickemId },
    },
    {
      $push: {
        pickems: {
          pickemId,
          predictions,
          submittedAt: acceptedAt,
          updatedAt: acceptedAt,
        },
      },
    },
    { runValidators: true },
  );

  return result.modifiedCount === 1;
}

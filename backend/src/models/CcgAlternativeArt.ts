import mongoose, { Document, Schema } from "mongoose";

export interface ICcgAlternativeArt extends Document {
  collectorKey: string;
  characterArtFilename?: string | null;
  characterArtEnabled: boolean;
  backgroundArtFilename?: string | null;
  backgroundArtEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CcgAlternativeArtSchema = new Schema<ICcgAlternativeArt>(
  {
    collectorKey: { type: String, required: true, unique: true, index: true },
    characterArtFilename: { type: String, default: null },
    characterArtEnabled: { type: Boolean, required: true, default: false },
    backgroundArtFilename: { type: String, default: null },
    backgroundArtEnabled: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

export default mongoose.model<ICcgAlternativeArt>("CcgAlternativeArt", CcgAlternativeArtSchema);

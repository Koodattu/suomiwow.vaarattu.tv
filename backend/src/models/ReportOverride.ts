import mongoose, { Schema } from "mongoose";

const ReportOverrideSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    assignment: {
      guildId: { type: Schema.Types.ObjectId, ref: "Guild" },
      previousGuildId: { type: Schema.Types.ObjectId, ref: "Guild" },
      reason: String,
      updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
      updatedAt: Date,
    },
    exclusions: [{
      _id: false,
      guildId: { type: Schema.Types.ObjectId, ref: "Guild", required: true },
      reason: String,
      updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
      updatedAt: Date,
    }],
    // Shared by API and worker processes so an in-flight fetch cannot undo an admin correction.
    lockToken: String,
    lockedAt: Date,
  },
  { timestamps: true },
);

ReportOverrideSchema.index({ "assignment.guildId": 1 });
ReportOverrideSchema.index({ "exclusions.guildId": 1 });

export default mongoose.model("ReportOverride", ReportOverrideSchema);

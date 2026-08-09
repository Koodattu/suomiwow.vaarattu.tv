import { ReporterSettings } from "./reporter.models";
import { ReporterRunSource, ReporterSettingsUpdate, ReporterSettingsValue } from "./reporter.types";

export const DEFAULT_REPORTER_SETTINGS: Readonly<ReporterSettingsValue> = Object.freeze({
  featureEnabled: false,
  automationEnabled: false,
  autoPublish: false,
});

function serializeSettings(settings: {
  featureEnabled: boolean;
  automationEnabled: boolean;
  autoPublish: boolean;
  updatedAt?: Date;
}): ReporterSettingsValue {
  return {
    featureEnabled: settings.featureEnabled,
    automationEnabled: settings.automationEnabled,
    autoPublish: settings.autoPublish,
    ...(settings.updatedAt ? { updatedAt: settings.updatedAt } : {}),
  };
}

export function shouldAutoPublishReporterPost(source: ReporterRunSource, settings: ReporterSettingsValue): boolean {
  return source === "cron" && settings.featureEnabled && settings.automationEnabled && settings.autoPublish;
}

class ReporterSettingsService {
  async get(): Promise<ReporterSettingsValue> {
    const settings = await ReporterSettings.findOne({ key: "global" });
    return settings ? serializeSettings(settings) : { ...DEFAULT_REPORTER_SETTINGS };
  }

  async update(input: ReporterSettingsUpdate): Promise<ReporterSettingsValue> {
    const set: ReporterSettingsUpdate = {};
    if (typeof input.featureEnabled === "boolean") set.featureEnabled = input.featureEnabled;
    if (typeof input.automationEnabled === "boolean") set.automationEnabled = input.automationEnabled;
    if (typeof input.autoPublish === "boolean") set.autoPublish = input.autoPublish;
    if (Object.keys(set).length === 0) throw new Error("At least one Reporter setting is required");

    const settings = await ReporterSettings.findOneAndUpdate(
      { key: "global" },
      { $set: set, $setOnInsert: { key: "global" } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    if (!settings) throw new Error("Reporter settings could not be saved");
    return serializeSettings(settings);
  }
}

export default new ReporterSettingsService();

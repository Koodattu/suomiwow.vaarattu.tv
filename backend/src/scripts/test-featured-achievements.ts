import assert from "assert/strict";
import {
  buildFeaturedAchievementTargets,
  classifyFeaturedAchievementName,
  countFeaturedAchievements,
  extractCompletedFeaturedAchievements,
  FeaturedAchievementCatalogRow,
} from "../utils/featured-achievements";

function buildCatalog(): FeaturedAchievementCatalogRow[] {
  const cuttingEdgeNames = [
    "Cutting Edge: N'Zoth the Corruptor",
    "Cutting Edge: Fyrakk the Blazing",
    "Cutting Edge: Queen Ansurek",
    "Cutting Edge: Chrome King Gallywix",
    "Cutting Edge: Dimensius, the All-Devouring",
    "Cutting Edge: Chimaerus, the Undreamt God",
    "Cutting Edge: Crown of the Cosmos",
    "Cutting Edge: Midnight Falls",
  ];
  const aheadOfTheCurveNames = [
    "Ahead of the Curve: The Black Gate",
    "Ahead of the Curve: G'huun",
    "Ahead of the Curve: Queen Azshara",
    "Ahead of the Curve: N'Zoth the Corruptor",
    "Ahead of the Curve: Sire Denathrius",
    "Ahead of the Curve: Sylvanas Windrunner",
    "Ahead of the Curve: The Jailer",
    "Ahead of the Curve: Raszageth the Storm-Eater",
    "Ahead of the Curve: Scalecommander Sarkareth",
    "Ahead of the Curve: Fyrakk the Blazing",
    "Ahead of the Curve: Queen Ansurek",
    "Ahead of the Curve: Chrome King Gallywix",
    "Ahead of the Curve: Dimensius, the All-Devouring",
    "Ahead of the Curve: Chimaerus, the Undreamt God",
    "Ahead of the Curve: Crown of the Cosmos",
    "Ahead of the Curve: Midnight Falls",
  ];

  return [
    ...cuttingEdgeNames.map((name, index) => ({ id: 50000 + index, name })),
    ...aheadOfTheCurveNames.map((name, index) => ({ id: 60000 + index, name })),
    { id: 70000, name: "Mythic: Not a Featured Achievement" },
    { id: 70001, name: "Ahead-ish of the Curve: Not a Match" },
  ];
}

function run(): void {
  assert.equal(classifyFeaturedAchievementName("Cutting Edge: Queen Ansurek"), "cutting_edge");
  assert.equal(classifyFeaturedAchievementName("Ahead of the Curve: Queen Ansurek"), "ahead_of_the_curve");
  assert.equal(classifyFeaturedAchievementName("Mythic: Queen Ansurek"), null);

  const catalog = buildCatalog();
  const targets = buildFeaturedAchievementTargets(catalog);
  assert.equal(targets.length, 24);
  assert.equal(targets.filter((target) => target.type === "cutting_edge").length, 8);
  assert.equal(targets.filter((target) => target.type === "ahead_of_the_curve").length, 16);

  const completedRows = targets.map((target, index) => ({
    id: target.id,
    achievement: { id: target.id, name: target.name },
    criteria:
      target.name === "Ahead of the Curve: G'huun"
        ? {
            is_completed: false,
            amount: 0,
          }
        : {
            is_completed: true,
            amount: 1,
          },
    completed_timestamp: 1_600_000_000_000 + index * 1000,
  }));

  const summary = {
    achievements: [
      ...completedRows,
      {
        id: 50000,
        achievement: { id: 50000, name: "Cutting Edge: N'Zoth the Corruptor" },
        completed_timestamp: 1_700_000_000_000,
      },
      {
        id: 70000,
        achievement: { id: 70000, name: "Mythic: Not a Featured Achievement" },
        completed_timestamp: 1_600_000_000_000,
      },
      {
        id: 60000,
        achievement: { id: 60000, name: "Ahead of the Curve: The Black Gate" },
        completed_timestamp: 0,
      },
    ],
  };

  const achievements = extractCompletedFeaturedAchievements(summary, targets);
  const counts = countFeaturedAchievements(achievements);

  assert.equal(counts.cuttingEdgeCount, 8);
  assert.equal(counts.aheadOfTheCurveCount, 16);
  assert.equal(counts.totalCount, 24);
  assert.equal(achievements.find((achievement) => achievement.name === "Ahead of the Curve: G'huun")?.completedTimestamp, 1_600_000_009_000);
  assert.equal(achievements.find((achievement) => achievement.achievementId === 50000)?.completedTimestamp, 1_600_000_000_000);
  assert.deepEqual(
    achievements.map((achievement) => achievement.completedTimestamp),
    [...achievements.map((achievement) => achievement.completedTimestamp)].sort((a, b) => a - b),
  );

  console.log("Featured achievement extraction tests passed.");
}

run();

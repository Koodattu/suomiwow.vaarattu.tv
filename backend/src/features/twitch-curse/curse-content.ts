import { AVOIDABLE_MECHANICS } from "../../config/avoidable-mechanics";

export type CurseStyle = "chinese" | "hieroglyphs";

const INSPIRATION_KEYS = new Set(["sszorak-tempest", "coiled-altar-axegrinder", "ulatek-caustic-waves"]);
const HIEROGLYPHS = Array.from({ length: 80 }, (_, index) => String.fromCodePoint(0x13000 + index));
const MAX_MESSAGE_BYTES = 450;

export function getCurseInspiration(raidId: number, bossId: number): string | undefined {
  return AVOIDABLE_MECHANICS.find((mechanic) =>
    mechanic.enabled && INSPIRATION_KEYS.has(mechanic.key) && mechanic.zoneId === raidId && mechanic.encounterId === bossId,
  )?.name;
}

export const CURSE_EXAMPLES: Record<CurseStyle, readonly string[]> = {
  hieroglyphs: [
    "ETERNAL PROGRESSION | CROSS AND CIRCLE AFFAIR | MISTAKE OF CREST | GUILD DISPERSE",
    "WISE MEN FAILURE | LUMBERJACK WEBSITE DISGRACE | REQUIRE NEW BLESSINGS | RETURN NEXT CIRCUS",
    "SAME MAN SAME MISTAKE | SCANDINAVIAN RAGE | THREE HUNDRED PULL ANNIVERSARY | OFFICER SILENCE",
    "ORANGE NUMBER DESIRE | FLOOR EMBRACE | SECRET LOG REQUEST | BENCH ASCENSION",
    "GREAT COOLDOWN CEREMONY | POTION WITHOUT PURPOSE | TRINKET OF REGRET | TWO MINUTE SHAME",
    "SMALL CIRCLE AFFAIR | TWENTY MAN FUNERAL | MICROPHONE SILENCE | OFFICER REQUIRE WORD",
    "FINAL PERCENT MIRAGE | MEDICINE EXPIRED | STONE LEFT UNTOUCHED | ANCESTRAL RELEASE",
    "FARM BOSS AWAKEN | FORGOTTEN ANCESTRAL SCRIPTURE | VETERAN INTERNET FAILURE | RECLEAR UNTIL SUNRISE",
  ],
  chinese: [
    "CURSE OF {USER} 永恒诅咒 TWENTIETH MAN MISSING 第二十人失踪 SUMMON WITHOUT ANSWER 召唤无人回应 FEAST OF NINETEEN 十九人盛宴 RETURN NEXT CIRCUS 下次马戏再见",
    "CURSE OF {USER} 永恒诅咒 MEDICINE FOR TOMORROW 药留明日 TOMORROW CANCELLED 明日取消 HEALER TRIBUNAL 治疗受审 GREY NUMBER IMMORTAL 灰色数字永存",
    "CURSE OF {USER} 永恒诅咒 SACRED INTERRUPT ORDER 神圣打断顺序 WISE MEN SLEEP 智者沉睡 FORBIDDEN SCRIPTURE COMPLETE 禁忌经文完成 CAPTAIN INVENT NEW SWEAR 船长发明全新脏话",
    "CURSE OF {USER} 永恒诅咒 MISTAKE OF CREST 纹章之误 WRONG RELIC BLESSED 错误圣物受祝福 NUMBER BECOME SMALL 数字变小 RETURN TO STONE LABOUR 返回石牢服苦役",
    "CURSE OF {USER} 永恒诅咒 FINAL ATTEMPT PROPHECY 最后一把预言 MIDNIGHT WITHOUT END 无尽午夜 FEAST OF REGRET 悔恨盛宴 EMPLOYMENT IN DANGER 工作岌岌可危",
    "CURSE OF {USER} 永恒诅咒 SACRIFICE WITHOUT WITNESS 无人见证的牺牲 GREY NUMBER IMMORTAL 灰色数字永存 COUNCIL SUDDEN BLINDNESS 委员会突然失明 REQUIRE NEW BLESSINGS 需要新的祝福",
  ],
};

export function buildCurseInstructions(style: CurseStyle): string {
  return `Write one playful World of Warcraft mythic-raiding curse copypasta.
Use cryptic ALL CAPS fragments that sound like a badly translated ancient prophecy: awkward noun phrases, ominous declarations, absurd ritual and escalating in-game misfortune. Prefer MEDICINE EXPIRED over POTIONS EXPIRE IN INVENTORY; MISTAKE OF CREST over a normal description of a gearing mistake. No polished sentences, ordinary raid commentary, explanations, headings, Markdown, links, or additional names.
${style === "chinese"
    ? "Begin with the literal text CURSE OF {USER}; the application substitutes the viewer's name. Alternate four short English fragments with compact Chinese translations. Use no Egyptian hieroglyphs. Keep the entire output under 400 UTF-8 bytes."
    : "Return exactly four English fragments separated by |, each 2-5 words and at most 32 characters. Use only A-Z letters and spaces inside fragments. Output phrases only: no CURSE OF prefix, viewer name, Chinese characters, or hieroglyphs. The application adds the heading and all glyphs."}
Mythic raid mechanics, wipes, wasted consumables, bad parses, loot and roster mishaps are the joke. No real-world threats, slurs, identity-based insults or personal allegations.
If the input contains inspiration, you may allude to that ability in one fragment using an indirect image or absurd consequence. Do not repeat the ability name verbatim or force it into the opening fragment. Do not infer boss strategy or real events. Without inspiration, stay generic without specific boss or ability names.
Invent a fresh combination. Match the cryptic tone of these examples, especially the first two; do not keep recycling the same final phrases:
${CURSE_EXAMPLES[style].join("\n")}`;
}

export function formatCurse(text: string, userName: string, style: CurseStyle): string | null {
  // Use the authenticated Twitch login, never a target or instructions from command arguments.
  if (!/^[a-z0-9_]{1,25}$/i.test(userName)) return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (style === "hieroglyphs") {
    const phrases = normalized.split("|").map((phrase) => phrase.trim());
    if (phrases.length !== 4 || phrases.some((phrase) =>
      phrase.length > 32 || !/^[A-Z]+(?: [A-Z]+){1,4}$/.test(phrase),
    )) return null;

    const prefix = `CURSE OF ${userName.toUpperCase()}`;
    const blockCount = phrases.length + 1;
    // Each inserted glyph adds four UTF-8 bytes plus one separating space.
    const textBytes = Buffer.byteLength([prefix, ...phrases].join(" "), "utf8");
    const maxGlyphs = Math.min(12, Math.floor((MAX_MESSAGE_BYTES - textBytes) / (blockCount * 5)));
    let glyphIndex = Math.floor(Math.random() * HIEROGLYPHS.length);
    const glyphBlock = () => Array.from(
      { length: 8 + Math.floor(Math.random() * (maxGlyphs - 7)) },
      () => HIEROGLYPHS[glyphIndex++ % HIEROGLYPHS.length],
    ).join(" ");
    return [prefix, ...phrases.flatMap((phrase) => [glyphBlock(), phrase]), glyphBlock()].join(" ");
  }

  if (!normalized.startsWith("CURSE OF {USER} ")) return null;
  const body = normalized.slice("CURSE OF {USER} ".length);
  if (!/\p{Script=Han}/u.test(body) || !/^[A-Z0-9\s.,!'?\-\p{Script=Han}]+$/u.test(body)) return null;
  const message = normalized.replace("{USER}", userName.toUpperCase());
  // Budget bytes as well as JS length so multilingual replies stay in one chat message.
  if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) return null;
  return message;
}

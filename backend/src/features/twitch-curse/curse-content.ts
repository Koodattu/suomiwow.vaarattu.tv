import { AVOIDABLE_MECHANICS } from "../../config/avoidable-mechanics";

export type CurseStyle = "chinese" | "hieroglyphs";

const INSPIRATION_KEYS = new Set(["sszorak-tempest", "coiled-altar-axegrinder", "ulatek-caustic-waves"]);

export function getCurseInspiration(raidId: number, bossId: number): string | undefined {
  return AVOIDABLE_MECHANICS.find((mechanic) =>
    mechanic.enabled && INSPIRATION_KEYS.has(mechanic.key) && mechanic.zoneId === raidId && mechanic.encounterId === bossId,
  )?.name;
}

export const CURSE_EXAMPLES: Record<CurseStyle, readonly string[]> = {
  hieroglyphs: [
    "CURSE OF {USER} 𓀀 𓀁 𓀂 𓀃 ETERNAL PROGRESSION 𓀄 𓀅 𓀆 𓀇 CROSS AND CIRCLE AFFAIR 𓀈 𓀉 𓀊 𓀋 MISTAKE OF CREST 𓀌 𓀍 𓀎 𓀏 GUILD DISPERSE",
    "CURSE OF {USER} 𓀀 𓀁 𓀂 𓀃 WISE MEN FAILURE 𓀄 𓀅 𓀆 𓀇 SCANDINAVIAN RAGE 𓀈 𓀉 𓀊 𓀋 LUMBERJACK WEBSITE DISGRACE 𓀌 𓀍 𓀎 𓀏 REQUIRE NEW BLESSINGS 𓀐 𓀑 𓀒 𓀓 RETURN NEXT CIRCUS",
    "CURSE OF {USER} 𓀀 𓀁 𓀂 𓀃 ETERNAL PROGRESSION 𓀄 𓀅 𓀆 𓀇 CROSS AND CIRCLE CONFUSION 𓀈 𓀉 𓀊 𓀋 SAME MAN SAME MISTAKE 𓀌 𓀍 𓀎 𓀏 THREE HUNDRED PULL ANNIVERSARY 𓀐 𓀑 𓀒 𓀓 GUILD DISPERSE",
    "CURSE OF {USER} 𓀙 𓀚 𓀛 𓀜 ORANGE NUMBER DESIRE 𓀞 𓀟 𓀠 𓀡 FLOOR EMBRACE 𓀣 𓀤 𓀥 𓀦 LUMBERJACK WEBSITE DISGRACE 𓀨 𓀩 𓀪 𓀫 SECRET LOG REQUEST 𓀭 𓀮 𓀯 𓀰 BENCH ACHIEVEMENT",
    "CURSE OF {USER} 𓀀 𓀁 𓀂 𓀃 GREAT COOLDOWN CEREMONY 𓀅 𓀆 𓀇 𓀈 BOSS BECOME UNTOUCHABLE 𓀊 𓀋 𓀌 𓀍 POTION WITHOUT PURPOSE 𓀏 𓀐 𓀑 𓀒 TRINKET OF REGRET 𓀔 𓀕 𓀖 𓀗 TWO MINUTE SHAME",
    "CURSE OF {USER} 𓀙 𓀚 𓀛 𓀜 SMALL CIRCLE DELIVERY 𓀞 𓀟 𓀠 𓀡 RETURN TO FRIEND GROUP 𓀣 𓀤 𓀥 𓀦 TWENTY MAN FUNERAL 𓀨 𓀩 𓀪 𓀫 MICROPHONE SUDDEN SILENCE 𓀭 𓀮 𓀯 𓀰 OFFICER REQUIRE WORD",
    "CURSE OF {USER} 𓀀 𓀁 𓀂 𓀃 FINAL PERCENT ARRIVAL 𓀅 𓀆 𓀇 𓀈 ALL MEDICINE MEN DECEASED 𓀊 𓀋 𓀌 𓀍 HEALTH STONE UNTOUCHED 𓀏 𓀐 𓀑 𓀒 RELEASE SPIRIT WORLD FIRST 𓀔 𓀕 𓀖 𓀗 NEXT PULL SOMEHOW WORSE",
    "CURSE OF {USER} 𓀙 𓀚 𓀛 𓀜 FARM BOSS AWAKEN 𓀞 𓀟 𓀠 𓀡 FORGOTTEN ANCESTRAL STRATEGY 𓀣 𓀤 𓀥 𓀦 NEW RECRUIT TOP DAMAGE 𓀨 𓀩 𓀪 𓀫 VETERAN INTERNET FAILURE 𓀭 𓀮 𓀯 𓀰 RECLEAR UNTIL SUNRISE",
  ],
  chinese: [
    "CURSE OF {USER} 永恒诅咒 TWENTY HERO REQUIRE 二十勇士缺一不可 NINETEEN HERO APPEAR 仅有十九人到场 SUMMON ABSENT CHAMPION 召唤失踪勇士 CHAMPION PLAY OTHER GAME 勇士正在玩别的游戏 RAID NIGHT EVAPORATE 团队之夜化为乌有",
    "CURSE OF {USER} 永恒诅咒 DEFENSIVE SAVED FOR FUTURE 防御技能留给未来 FUTURE NEVER ARRIVE 未来不再到来 HEALER RECEIVE ACCUSATION 治疗遭到指责 DEATH LOG REVEAL TRUTH 死亡记录揭示真相 MICROPHONE EXCUSE RITUAL 麦克风辩解仪式",
    "CURSE OF {USER} 永恒诅咒 SACRED INTERRUPT ORDER 神圣打断顺序 FIRST MAN SLEEP 第一人沉睡 SECOND MAN ALSO SLEEP 第二人亦沉睡 FORBIDDEN CAST COMPLETE 禁忌施法完成 CAPTAIN INVENT NEW SWEAR 船长发明全新脏话",
    "CURSE OF {USER} 永恒诅咒 SMALL UPGRADE TEMPTATION 微小提升的诱惑 ANCESTRAL CREST SPENT 先祖纹章耗尽 WRONG ITEM EMPOWERED 错误装备得到强化 SIMULATION NUMBER DECREASE 模拟数字下降 RETURN TO STONE LABOUR 返回地下城服苦役",
    "CURSE OF {USER} 永恒诅咒 PROMISED FINAL ATTEMPT 承诺最后一把 MIDNIGHT BECOME MORNING 午夜变成清晨 MANY FEASTS PERISH 无数盛宴消逝 BEST PULL THREE HOURS AGO 最佳尝试已是三小时前 EMPLOYMENT IN DANGER 工作岌岌可危",
    "CURSE OF {USER} 永恒诅咒 PERFECT MECHANIC EXECUTION 机制执行完美 SACRIFICE FOR RAID 为团队牺牲 GREY NUMBER IMMORTALIZED 灰色数字永世留存 LOOT COUNCIL DEVELOP BLINDNESS 装备委员会突然失明 NEXT WEEK PROVE AGAIN 下周再次证明自己",
  ],
};

export function buildCurseInstructions(style: CurseStyle): string {
  return `Write one playful World of Warcraft mythic-raiding curse copypasta. Begin with the literal text CURSE OF {USER}; the application substitutes the viewer's name.
Use 4-5 terse, ominous fragments in ALL CAPS English, with absurd literal wording and escalating in-game misfortune. No polished sentences, explanations, headings, Markdown, links, or additional names.
${style === "chinese"
    ? "Alternate English fragments with short Chinese translations. Use no Egyptian hieroglyphs."
    : "Separate English fragments with runs of 3-5 Egyptian hieroglyphs. Use no Chinese characters."}
Keep the whole message under 400 UTF-8 bytes: short fragments and compact separators. Mythic raid mechanics, wipes, wasted consumables, bad parses, loot and roster mishaps are the joke. No real-world threats, slurs, identity-based insults or personal allegations.
If the input contains inspiration, use that single ability name as inspiration for one fragment. Do not infer boss strategy or real events from it. Otherwise keep it generic without naming a specific boss or ability.
Invent a fresh combination in this style; examples are tone references:
${CURSE_EXAMPLES[style].join("\n")}`;
}

export function formatCurse(text: string, userName: string, style: CurseStyle): string | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized.startsWith("CURSE OF {USER} ")) return null;
  const body = normalized.slice("CURSE OF {USER} ".length);
  const hasChinese = /\p{Script=Han}/u.test(body);
  const hasHieroglyphs = /\p{Script=Egyptian_Hieroglyphs}/u.test(body);
  if (style === "chinese" ? !hasChinese || hasHieroglyphs : !hasHieroglyphs || hasChinese) return null;
  if (!/^[A-Z0-9\s.,!'?\-\p{Script=Han}\p{Script=Egyptian_Hieroglyphs}]+$/u.test(body)) return null;
  // Use the authenticated Twitch login, never a target or instructions from command arguments.
  if (!/^[a-z0-9_]{1,25}$/i.test(userName)) return null;
  const message = normalized.replace("{USER}", userName.toUpperCase());
  // Budget bytes as well as JS length so multilingual replies stay in one chat message.
  if (Buffer.byteLength(message, "utf8") > 450) return null;
  return message;
}

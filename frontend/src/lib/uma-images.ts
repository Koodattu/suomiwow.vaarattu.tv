export const UMA_IMAGES = [
  "daiwa scarlet.png",
  "el condor pasa.png",
  "gold ship.png",
  "grass wonder.png",
  "haru urara.png",
  "manhattan cafe.png",
  "mejiro mcqueen.png",
  "mihono bourbon.png",
  "oguri cap.png",
  "rice shower.png",
  "seiun sky.png",
  "silence suzuka.png",
  "smart falcon.png",
  "special week.png",
  "super creek.png",
  "tokai teio.png",
  "winning ticket.png",
  "laku clap.png",
  "tony halme.png",
  "marvelous sunday.png",
  "tokai teio wheelchair.png",
  "turbo saab.png",
] as const;

export type UmaImage = (typeof UMA_IMAGES)[number];

export function isUmaImage(value: string | null | undefined): value is UmaImage {
  return typeof value === "string" && (UMA_IMAGES as readonly string[]).includes(value);
}

export function getUmaImageLabel(image: string) {
  return image
    .replace(/\.png$/i, "")
    .split(" ")
    .map((word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : word))
    .join(" ");
}

import { Texture } from "three";
import { createBoxPrints, boxPrintKey, tapeTexture, PACKAGING_THEMES, seriesTheme, unreleasedBoxDesign } from "/lib/figurine-packaging.ts";
const status=document.querySelector("#status"), designs=await fetch("/designs").then(r=>r.json());
try {
  for(const entry of designs) {
    const design=entry.id==="unreleased"?unreleasedBoxDesign(entry.labels):{labels:entry.labels,lineup:entry.lineup,silhouettes:entry.silhouettes,theme:entry.theme?PACKAGING_THEMES[entry.theme]:seriesTheme(entry.number,entry.hue)};
    for(const density of [150,500]) {
      status.textContent=`Baking ${entry.locale} ${entry.id}, ${density} px/unit…`;
      // The close-up tier is repainted at twice the source density, then encoded at 2048px.
      // Keep the shelf tier small and leave finish masks at their separate resolution cap.
      const bakeDensity=density===500?1000:density;
      const environment=new Texture(), prints=createBoxPrints(design,environment,bakeDensity,density===500?500:250);await prints.ready;
      const seal=tapeTexture(design.labels.openHere), maps={inside:prints.inside.map.image.toDataURL("image/png"),seal:seal.image.toDataURL("image/png")};
      for(const name of ["front","back","left","right","lid"]) {
        maps[`${name}-color`]=prints[name].map.image.toDataURL("image/png");
        maps[`${name}-finish`]=prints[name].roughnessMap.image.toDataURL("image/png");
      }
      const response=await fetch("/prints",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:boxPrintKey(design),density,maps})});
      if(!response.ok)throw new Error(await response.text());
      prints.stop();const textures=new Set([seal,environment]);
      for(const name of ["front","back","left","right","lid","inside","edge"]){for(const value of Object.values(prints[name]))if(value?.isTexture)textures.add(value);prints[name].dispose();}
      textures.forEach(t=>t.dispose());
    }
  }
  status.textContent=`Complete: ${designs.length} localized designs at two resolutions.`;
} catch(error) {status.textContent=`FAILED: ${error.stack}`;}

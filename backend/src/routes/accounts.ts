import { Router } from "express";
import characterService from "../services/character.service";
import logger from "../utils/logger";

const router = Router();

router.get("/:slug", async (req, res) => {
  try {
    const slug = decodeURIComponent(req.params.slug);
    const account = await characterService.getCharacterAccountBySlug(slug);

    if (!account) {
      return res.status(404).json({ error: "Account not found" });
    }

    res.json(account);
  } catch (error) {
    logger.error("Error fetching character account:", error);
    res.status(500).json({ error: "Failed to fetch account" });
  }
});

export default router;

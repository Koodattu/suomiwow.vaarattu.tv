# SuomiWoW

SuomiWoW is a fan-made community hub and living record of Finnish World of Warcraft raiding. It brings guild progression, character performance, raid history, livestreams, and community games together in one bilingual site.

[Visit SuomiWoW](https://suomiwow.vaarattu.tv)

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=black)
![Express](https://img.shields.io/badge/Express-5-000000?style=flat&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?style=flat&logo=mongodb&logoColor=white)

![SuomiWoW guild progression dashboard](images/preview.jpg)

## What is in it?

What began as a guild progress tracker has grown into a wider home for the Finnish WoW scene:

- **Guild progression:** follow current and historical raid tiers, Mythic and Heroic clears, world ranks, pull counts, progress percentages, and time spent raiding.
- **Guild and character profiles:** explore raid history, boss-by-boss results, rankings, achievements, highlights, guild movement, and linked character histories.
- **Character leaderboards:** compare Warcraft Logs performance, mechanics and survival scores, combined scores, roles, specs, and Mythic+ seasons.
- **Analytics and tier lists:** compare guilds by progress, speed, efficiency, pulls, and raid time; browse generated character tiers or create and share a custom guild tier list.
- **A lively front row:** recent kills and best pulls, a visual raid race, weekly timetables, guilds raiding today, live Twitch streams, and VOD links keep the scene easy to follow.
- **Community play:** make Pick'em predictions, follow the standings, search across guilds and characters, and sign in to connect your community identity.
- **Finnish and English:** the public experience is maintained in both languages.

## SuomiWoW CCG

The collectible card game turns the site's raid history into something playful. Open free five-card packs and collect the characters who shaped each tier—from current raids to legacy and community sets.

Cards preserve a snapshot of a character's guild, role, appearance, raid performance, mechanics, and Mythic+ record. Collections include rarity tiers, premium finishes, alternative art, favorites, set completion, shareable pulls, collector profiles, and a collection leaderboard. Packs recharge automatically, and account holders can also receive redeem-code and Twitch rewards.

The CCG is free, non-tradable, and non-commercial. There are no purchases or pay-to-progress mechanics.

## How the data comes together

SuomiWoW combines several sources into one historical view:

- [Warcraft Logs](https://www.warcraftlogs.com/) for reports, fights, rankings, and progression
- [Blizzard Battle.net](https://develop.battle.net/) for character media, guild crests, and achievements
- [Raider.IO](https://raider.io/) for raid metadata and Mythic+ data
- [Twitch](https://www.twitch.tv/) for live channels, VODs, chat integrations, and community rewards

Background workers keep active guilds fresh while preserving data from older raid tiers. The frontend adds filtering, comparisons, charts, shareable views, and Discord-based community profiles on top.

## Tech stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, TanStack Query, and Recharts
- **Backend:** Node.js 24, Express 5, TypeScript, MongoDB 7, and Mongoose
- **Operations:** Docker Compose, a dedicated background worker, and Nginx

## Run it locally

The easiest route is Docker. You will need Docker with Compose plus API credentials for Warcraft Logs and Blizzard. Raider.IO, Twitch, and Discord credentials enable their corresponding features.

```bash
git clone https://github.com/Koodattu/wow-guild-progress-tracker.git
cd wow-guild-progress-tracker

cp backend/.env.example backend/.env
# Add your API credentials and a session secret to backend/.env

docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) for the app. The API runs on [http://localhost:3001](http://localhost:3001).

MongoDB must run as a replica set because collection and guest-claim flows use transactions. The included Compose setup creates a single-node `rs0` replica set automatically.

For development without Docker, use Node.js 24 and MongoDB 7, install dependencies in both `backend` and `frontend`, then run `npm run dev` in each directory.

## Configuration

- Copy [`backend/.env.example`](backend/.env.example) to `backend/.env` for credentials and feature flags.
- Edit [`backend/src/config/guilds.ts`](backend/src/config/guilds.ts) to choose guilds, raid tiers, current raids, streamers, and Pick'em options.
- Use `CCG_FEATURE_ENABLED=false` to hide the CCG or `CCG_WEEKLY_AUTOMATION_ENABLED=false` to stop its weekly publication jobs without removing collection data.

## License and disclaimer

The source code is available under the [MIT License](LICENSE).

SuomiWoW is an unofficial fan project and is not affiliated with Blizzard Entertainment. World of Warcraft and related artwork are trademarks or copyrights of Blizzard Entertainment.

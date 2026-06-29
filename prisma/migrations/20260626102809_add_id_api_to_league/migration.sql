/*
  Warnings:

  - A unique constraint covering the columns `[id_api]` on the table `LEAGUE` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id_api]` on the table `MARKET` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[match_id,team_id,market_id]` on the table `MATCH_TEAM_STAT` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[league_id,id_api]` on the table `SEASON` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id_api]` on the table `TEAM` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "MARKET" ADD COLUMN     "id_api" TEXT;

-- CreateTable
CREATE TABLE "MATCH_ODDS" (
    "id" SERIAL NOT NULL,
    "match_id" INTEGER NOT NULL,
    "market_id" INTEGER NOT NULL,
    "bookmaker_name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "odd" DECIMAL(65,30) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MATCH_ODDS_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MATCH_ODDS_match_id_market_id_bookmaker_name_slug_key" ON "MATCH_ODDS"("match_id", "market_id", "bookmaker_name", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "LEAGUE_id_api_key" ON "LEAGUE"("id_api");

-- CreateIndex
CREATE UNIQUE INDEX "MARKET_id_api_key" ON "MARKET"("id_api");

-- CreateIndex
CREATE UNIQUE INDEX "MATCH_TEAM_STAT_match_id_team_id_market_id_key" ON "MATCH_TEAM_STAT"("match_id", "team_id", "market_id");

-- CreateIndex
CREATE UNIQUE INDEX "SEASON_league_id_id_api_key" ON "SEASON"("league_id", "id_api");

-- CreateIndex
CREATE UNIQUE INDEX "TEAM_id_api_key" ON "TEAM"("id_api");

-- AddForeignKey
ALTER TABLE "MATCH_ODDS" ADD CONSTRAINT "MATCH_ODDS_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "MATCH"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MATCH_ODDS" ADD CONSTRAINT "MATCH_ODDS_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "MARKET"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

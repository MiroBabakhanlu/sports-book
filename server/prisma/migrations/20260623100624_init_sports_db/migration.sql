-- CreateTable
CREATE TABLE "SPORT" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "api_provider" TEXT NOT NULL,
    "id_api" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SPORT_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LEAGUE" (
    "id" SERIAL NOT NULL,
    "sport_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT,
    "id_api" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LEAGUE_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SEASON" (
    "id" SERIAL NOT NULL,
    "league_id" INTEGER NOT NULL,
    "year" TEXT NOT NULL,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "is_current" BOOLEAN NOT NULL,
    "id_api" TEXT NOT NULL,

    CONSTRAINT "SEASON_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TEAM" (
    "id" SERIAL NOT NULL,
    "sport_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "logo_url" TEXT,
    "id_api" TEXT NOT NULL,
    "country" TEXT,
    "is_active" BOOLEAN NOT NULL,

    CONSTRAINT "TEAM_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MATCH" (
    "id" SERIAL NOT NULL,
    "season_id" INTEGER NOT NULL,
    "home_team_id" INTEGER NOT NULL,
    "away_team_id" INTEGER NOT NULL,
    "matchday" INTEGER,
    "kickoff_at" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "home_score" INTEGER,
    "away_score" INTEGER,
    "winner_team_id" INTEGER,
    "id_api" TEXT NOT NULL,
    "venue" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MATCH_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MARKET" (
    "id" SERIAL NOT NULL,
    "sport_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "MARKET_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MATCH_TEAM_STAT" (
    "id" SERIAL NOT NULL,
    "match_id" INTEGER NOT NULL,
    "team_id" INTEGER NOT NULL,
    "market_id" INTEGER NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "side" TEXT NOT NULL,

    CONSTRAINT "MATCH_TEAM_STAT_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TEAM_SEASON_AVERAGE" (
    "id" SERIAL NOT NULL,
    "team_id" INTEGER NOT NULL,
    "season_id" INTEGER NOT NULL,
    "market_id" INTEGER NOT NULL,
    "avg_value" DECIMAL(65,30) NOT NULL,
    "avg_value_home" DECIMAL(65,30),
    "avg_value_away" DECIMAL(65,30),
    "matches_played" INTEGER NOT NULL,
    "recalculated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TEAM_SEASON_AVERAGE_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TEAM_STREAK" (
    "id" SERIAL NOT NULL,
    "team_id" INTEGER NOT NULL,
    "season_id" INTEGER NOT NULL,
    "market_id" INTEGER NOT NULL,
    "streak_length" INTEGER NOT NULL,
    "streak_direction" TEXT NOT NULL,
    "recalculated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TEAM_STREAK_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SPORT_name_key" ON "SPORT"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SPORT_slug_key" ON "SPORT"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "LEAGUE_slug_key" ON "LEAGUE"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "MATCH_id_api_key" ON "MATCH"("id_api");

-- CreateIndex
CREATE UNIQUE INDEX "MARKET_slug_key" ON "MARKET"("slug");

-- AddForeignKey
ALTER TABLE "LEAGUE" ADD CONSTRAINT "LEAGUE_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "SPORT"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SEASON" ADD CONSTRAINT "SEASON_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "LEAGUE"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TEAM" ADD CONSTRAINT "TEAM_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "SPORT"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MATCH" ADD CONSTRAINT "MATCH_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "SEASON"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MATCH" ADD CONSTRAINT "MATCH_home_team_id_fkey" FOREIGN KEY ("home_team_id") REFERENCES "TEAM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MATCH" ADD CONSTRAINT "MATCH_away_team_id_fkey" FOREIGN KEY ("away_team_id") REFERENCES "TEAM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MATCH" ADD CONSTRAINT "MATCH_winner_team_id_fkey" FOREIGN KEY ("winner_team_id") REFERENCES "TEAM"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MARKET" ADD CONSTRAINT "MARKET_sport_id_fkey" FOREIGN KEY ("sport_id") REFERENCES "SPORT"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MATCH_TEAM_STAT" ADD CONSTRAINT "MATCH_TEAM_STAT_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "MATCH"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MATCH_TEAM_STAT" ADD CONSTRAINT "MATCH_TEAM_STAT_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "TEAM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MATCH_TEAM_STAT" ADD CONSTRAINT "MATCH_TEAM_STAT_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "MARKET"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TEAM_SEASON_AVERAGE" ADD CONSTRAINT "TEAM_SEASON_AVERAGE_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "TEAM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TEAM_SEASON_AVERAGE" ADD CONSTRAINT "TEAM_SEASON_AVERAGE_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "SEASON"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TEAM_SEASON_AVERAGE" ADD CONSTRAINT "TEAM_SEASON_AVERAGE_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "MARKET"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TEAM_STREAK" ADD CONSTRAINT "TEAM_STREAK_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "TEAM"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TEAM_STREAK" ADD CONSTRAINT "TEAM_STREAK_season_id_fkey" FOREIGN KEY ("season_id") REFERENCES "SEASON"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TEAM_STREAK" ADD CONSTRAINT "TEAM_STREAK_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "MARKET"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

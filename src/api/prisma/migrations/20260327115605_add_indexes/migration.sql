-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");

-- CreateIndex
CREATE INDEX "incidents_category_idx" ON "incidents"("category");

-- CreateIndex
CREATE INDEX "incidents_created_by_id_idx" ON "incidents"("created_by_id");

-- CreateIndex
CREATE INDEX "incidents_assigned_team_id_idx" ON "incidents"("assigned_team_id");

-- CreateIndex
CREATE INDEX "incidents_sla_breached_idx" ON "incidents"("sla_breached");

-- CreateIndex
CREATE INDEX "knowledge_articles_author_id_idx" ON "knowledge_articles"("author_id");

-- CreateIndex
CREATE INDEX "service_requests_priority_idx" ON "service_requests"("priority");

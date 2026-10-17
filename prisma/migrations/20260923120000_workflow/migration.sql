-- AlterTable
ALTER TABLE "QueueJob" ADD COLUMN "runAt" DATETIME;

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishTimes" JSONB NOT NULL DEFAULT [],
    "days" JSONB NOT NULL DEFAULT [],
    "writeAheadHours" INTEGER NOT NULL DEFAULT 12,
    "images" BOOLEAN,
    "indexAfterPublish" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workflow_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "secondaryKeywords" JSONB NOT NULL DEFAULT [],
    "kind" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "kindSource" TEXT,
    "kindNote" TEXT,
    "state" TEXT NOT NULL DEFAULT 'WAITING',
    "taskId" TEXT,
    "publishAt" DATETIME,
    "publishedUrl" TEXT,
    "publishedAt" DATETIME,
    "indexedAt" DATETIME,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowKeyword_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowKeyword_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Website" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "adminUrl" TEXT NOT NULL,
    "profileId" TEXT,
    "defaultCategoryId" TEXT,
    "defaultAuthor" TEXT,
    "editorType" TEXT NOT NULL DEFAULT 'AUTO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "celebrityImages" BOOLEAN NOT NULL DEFAULT true,
    "tigramImages" BOOLEAN NOT NULL DEFAULT true,
    "logoFile" TEXT,
    "accentColour" TEXT,
    "logoPosition" TEXT,
    "featuredStyle" TEXT,
    "imageTemplate" JSONB,
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "siteTimezone" TEXT,
    "searchConsoleProperty" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Website_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BrowserProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Website" ("accentColour", "adminUrl", "celebrityImages", "createdAt", "defaultAuthor", "defaultCategoryId", "editorType", "featuredStyle", "id", "imageTemplate", "isActive", "logoFile", "logoPosition", "name", "profileId", "tigramImages", "updatedAt", "url") SELECT "accentColour", "adminUrl", "celebrityImages", "createdAt", "defaultAuthor", "defaultCategoryId", "editorType", "featuredStyle", "id", "imageTemplate", "isActive", "logoFile", "logoPosition", "name", "profileId", "tigramImages", "updatedAt", "url" FROM "Website";
DROP TABLE "Website";
ALTER TABLE "new_Website" RENAME TO "Website";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_websiteId_key" ON "Workflow"("websiteId");

-- CreateIndex
CREATE INDEX "WorkflowKeyword_workflowId_state_idx" ON "WorkflowKeyword"("workflowId", "state");

-- CreateIndex
CREATE INDEX "WorkflowKeyword_publishAt_idx" ON "WorkflowKeyword"("publishAt");


-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ADMIN',
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BrowserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "directory" TEXT NOT NULL,
    "sessionStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "sessionDetail" TEXT,
    "lastCheckedAt" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Website" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "adminUrl" TEXT NOT NULL,
    "profileId" TEXT,
    "defaultCategoryId" TEXT,
    "defaultAuthor" TEXT,
    "editorType" TEXT NOT NULL DEFAULT 'AUTO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Website_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BrowserProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Category_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleKey" TEXT NOT NULL DEFAULT 'celebrity-writer',
    "keyword" TEXT NOT NULL,
    "exampleTitle" TEXT,
    "secondaryKeywords" JSONB NOT NULL DEFAULT [],
    "targetCountry" TEXT,
    "language" TEXT,
    "websiteId" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "createdById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "currentStage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "statusMessage" TEXT,
    "reviewReasons" JSONB NOT NULL DEFAULT [],
    "loginRequiredFor" TEXT,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "titleOptions" JSONB NOT NULL DEFAULT [],
    "recommendedTitle" TEXT,
    "selectedTitle" TEXT,
    "titleApprovedAt" DATETIME,
    "articleApprovedAt" DATETIME,
    "bodyHtml" TEXT,
    "contentHtml" TEXT,
    "faqs" JSONB,
    "quickBio" JSONB,
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "slug" TEXT,
    "focusKeyword" TEXT,
    "tags" JSONB NOT NULL DEFAULT [],
    "wordCount" INTEGER,
    "keywordCount" INTEGER,
    "keywordDensity" REAL,
    "h2Count" INTEGER,
    "h3Count" INTEGER,
    "seoScore" INTEGER,
    "rankMathScore" INTEGER,
    "chatgptConversationUrl" TEXT,
    "wpPostId" TEXT,
    "wpEditUrl" TEXT,
    "wpDraftSavedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleTask_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ArticleTask_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ArticleTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT,
    "output" TEXT,
    "outputHtml" TEXT,
    "data" JSONB,
    "error" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleStage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatGPTResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "prompt" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "responseHtml" TEXT,
    "conversationUrl" TEXT,
    "reusedExisting" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatGPTResponse_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "category" TEXT NOT NULL,
    "stage" TEXT,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "screenshotPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Log_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QueueJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskId" TEXT,
    "data" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedBy" TEXT,
    "heartbeatAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "WorkerStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastSeenAt" DATETIME NOT NULL,
    "info" JSONB
);

-- CreateTable
CREATE TABLE "SEOReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "score" INTEGER,
    "checks" JSONB NOT NULL,
    "metrics" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SEOReport_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserProfile_directory_key" ON "BrowserProfile"("directory");

-- CreateIndex
CREATE UNIQUE INDEX "Category_websiteId_name_key" ON "Category"("websiteId", "name");

-- CreateIndex
CREATE INDEX "ArticleTask_status_idx" ON "ArticleTask"("status");

-- CreateIndex
CREATE INDEX "ArticleTask_createdAt_idx" ON "ArticleTask"("createdAt");

-- CreateIndex
CREATE INDEX "ArticleTask_moduleKey_idx" ON "ArticleTask"("moduleKey");

-- CreateIndex
CREATE INDEX "ArticleTask_websiteId_idx" ON "ArticleTask"("websiteId");

-- CreateIndex
CREATE INDEX "ArticleStage_taskId_idx" ON "ArticleStage"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleStage_taskId_key_key" ON "ArticleStage"("taskId", "key");

-- CreateIndex
CREATE INDEX "ChatGPTResponse_taskId_stageKey_idx" ON "ChatGPTResponse"("taskId", "stageKey");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_moduleKey_key_key" ON "PromptTemplate"("moduleKey", "key");

-- CreateIndex
CREATE INDEX "Log_taskId_idx" ON "Log"("taskId");

-- CreateIndex
CREATE INDEX "Log_createdAt_idx" ON "Log"("createdAt");

-- CreateIndex
CREATE INDEX "Log_level_idx" ON "Log"("level");

-- CreateIndex
CREATE INDEX "QueueJob_queue_status_createdAt_idx" ON "QueueJob"("queue", "status", "createdAt");

-- CreateIndex
CREATE INDEX "QueueJob_taskId_status_idx" ON "QueueJob"("taskId", "status");

-- CreateIndex
CREATE INDEX "SEOReport_taskId_idx" ON "SEOReport"("taskId");


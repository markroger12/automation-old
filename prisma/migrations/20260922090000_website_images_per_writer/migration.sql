-- Images are switched on or off separately for celebrity articles and for Tigram articles.
-- Both new switches start with the value of the old single one, so a website that had images off keeps them off.
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Website_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BrowserProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Website" ("accentColour", "adminUrl", "celebrityImages", "createdAt", "defaultAuthor", "defaultCategoryId", "editorType", "featuredStyle", "id", "imageTemplate", "isActive", "logoFile", "logoPosition", "name", "profileId", "tigramImages", "updatedAt", "url") SELECT "accentColour", "adminUrl", "articleImages", "createdAt", "defaultAuthor", "defaultCategoryId", "editorType", "featuredStyle", "id", "imageTemplate", "isActive", "logoFile", "logoPosition", "name", "profileId", "articleImages", "updatedAt", "url" FROM "Website";
DROP TABLE "Website";
ALTER TABLE "new_Website" RENAME TO "Website";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

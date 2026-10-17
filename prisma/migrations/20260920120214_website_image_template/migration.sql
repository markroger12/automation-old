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
    "articleImages" BOOLEAN NOT NULL DEFAULT true,
    "logoFile" TEXT,
    "accentColour" TEXT,
    "logoPosition" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Website_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BrowserProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Website" ("adminUrl", "createdAt", "defaultAuthor", "defaultCategoryId", "editorType", "id", "isActive", "name", "profileId", "updatedAt", "url") SELECT "adminUrl", "createdAt", "defaultAuthor", "defaultCategoryId", "editorType", "id", "isActive", "name", "profileId", "updatedAt", "url" FROM "Website";
DROP TABLE "Website";
ALTER TABLE "new_Website" RENAME TO "Website";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Phase 9 Pass B1b — widen media URL columns to TEXT.
--
-- Why: a placeholder image is stored as a `data:` URI, which runs to several
-- hundred characters. The init migration created these columns as
-- VARCHAR(191), so MySQL truncated the value silently and every thumbnail
-- rendered broken. `prisma db push` had already widened the live database,
-- which is exactly why this drift survived: `migrate status` compares applied
-- history, not column types.
--
-- Generated with:
--   prisma migrate diff --from-schema-datamodel <before> --to-schema-datamodel <after> --script
-- It touches only the four media URL columns. Nothing else in the schema moved.

-- AlterTable
ALTER TABLE `ProductImage` MODIFY `url` TEXT NOT NULL;

-- AlterTable
ALTER TABLE `ProductVideo` MODIFY `url` TEXT NOT NULL,
    MODIFY `thumbnailUrl` TEXT NULL;

-- AlterTable
ALTER TABLE `ReviewMedia` MODIFY `url` TEXT NOT NULL;

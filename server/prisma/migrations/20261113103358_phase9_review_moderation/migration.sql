-- AlterTable
ALTER TABLE `review` ADD COLUMN `moderatedAt` DATETIME(3) NULL,
    ADD COLUMN `moderatedBy` VARCHAR(191) NULL;

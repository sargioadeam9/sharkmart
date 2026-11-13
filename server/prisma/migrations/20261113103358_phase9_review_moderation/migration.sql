-- AlterTable
ALTER TABLE `Review` ADD COLUMN `moderatedAt` DATETIME(3) NULL,
    ADD COLUMN `moderatedBy` VARCHAR(191) NULL;

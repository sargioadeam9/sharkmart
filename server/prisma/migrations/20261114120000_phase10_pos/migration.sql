-- Phase 10 pass M — counter sales.
--
-- A POS sale is an `Order` with `channel = 'POS'`, not a row in a parallel sales
-- table. That is the whole design: revenue reports, the order list and the
-- dashboard keep working untouched, and there is one place a sale can live.
--
-- `PosSession` therefore holds only what an order cannot: the drawer float, the
-- shift boundary, and the cash count at close.

-- CreateTable
CREATE TABLE `PosSession` (
    `id` VARCHAR(191) NOT NULL,
    `openedBy` VARCHAR(191) NOT NULL,
    `openedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `openingCashPoisha` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `closedBy` VARCHAR(191) NULL,
    `closedAt` DATETIME(3) NULL,
    `countedCashPoisha` INTEGER NULL,
    `expectedCashPoisha` INTEGER NULL,
    `variancePoisha` INTEGER NULL,
    `saleCount` INTEGER NULL,
    `cashSalesPoisha` INTEGER NULL,
    `cardSalesPoisha` INTEGER NULL,
    `otherSalesPoisha` INTEGER NULL,
    `note` TEXT NULL,

    INDEX `PosSession_status_idx`(`status`),
    INDEX `PosSession_openedAt_idx`(`openedAt`),
    INDEX `PosSession_openedBy_status_idx`(`openedBy`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `Order`
    ADD COLUMN `channel` ENUM('ONLINE', 'POS') NOT NULL DEFAULT 'ONLINE',
    ADD COLUMN `posSessionId` VARCHAR(191) NULL,
    ADD COLUMN `cashReceivedPoisha` INTEGER NULL,
    ADD COLUMN `changePoisha` INTEGER NULL,
    ADD COLUMN `posClientRef` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Order_channel_idx` ON `Order`(`channel`);

-- CreateIndex
CREATE INDEX `Order_posSessionId_idx` ON `Order`(`posSessionId`);

-- CreateIndex
CREATE UNIQUE INDEX `Order_posClientRef_key` ON `Order`(`posClientRef`);

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_posSessionId_fkey` FOREIGN KEY (`posSessionId`) REFERENCES `PosSession`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

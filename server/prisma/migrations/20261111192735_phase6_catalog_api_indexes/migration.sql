-- AlterTable
ALTER TABLE `Product` ADD COLUMN `originalPricePoisha` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `Product_isPublished_isDraft_categoryId_createdAt_idx` ON `Product`(`isPublished`, `isDraft`, `categoryId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Product_isPublished_isDraft_brandId_createdAt_idx` ON `Product`(`isPublished`, `isDraft`, `brandId`, `createdAt`);

-- CreateIndex
CREATE INDEX `Product_isPublished_isDraft_createdAt_idx` ON `Product`(`isPublished`, `isDraft`, `createdAt`);

-- CreateIndex
CREATE INDEX `Product_isPublished_isDraft_basePricePoisha_idx` ON `Product`(`isPublished`, `isDraft`, `basePricePoisha`);

-- CreateIndex
CREATE INDEX `Product_isPublished_isDraft_ratingAvg_idx` ON `Product`(`isPublished`, `isDraft`, `ratingAvg`);

-- CreateIndex
CREATE INDEX `Product_isFlashSale_flashSaleStart_flashSaleEnd_idx` ON `Product`(`isFlashSale`, `flashSaleStart`, `flashSaleEnd`);

-- Phase 12 — outbound notifications: email (Resend) and Telegram.
--
-- Three changes, all of them consequences of the same decision: a message is a
-- row, and the row has to be able to address someone who is not a registered
-- user.
--
--  1. `Notification.recipientId` becomes nullable and the address moves onto the
--     row (`toEmail` / `toPhone`). A guest order is the common case here, and it
--     could not be emailed at all while the FK was required.
--  2. `Notification.error` and `attempts` record why a send failed. Without them
--     a failed row is a row that says PENDING forever and nobody knows why.
--  3. `Order.contactEmail` and `EmailTemplate.key` — the first is where an order
--     says who to mail; the second lets the code find a template by a stable
--     name instead of by a label an operator can rename.

-- AlterTable: Notification
ALTER TABLE `Notification`
    MODIFY `recipientId` VARCHAR(191) NULL,
    ADD COLUMN `toEmail` VARCHAR(191) NULL,
    ADD COLUMN `toPhone` VARCHAR(191) NULL,
    ADD COLUMN `error` VARCHAR(191) NULL,
    ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX `Notification_type_createdAt_idx` ON `Notification`(`type`, `createdAt`);

-- AlterTable: Order
ALTER TABLE `Order` ADD COLUMN `contactEmail` VARCHAR(191) NULL;

-- AlterTable: EmailTemplate
ALTER TABLE `EmailTemplate` ADD COLUMN `key` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `EmailTemplate_key_key` ON `EmailTemplate`(`key`);

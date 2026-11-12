-- Rename the house brands: drop the "O" prefix inherited from the old
-- OShoppingBD brand (OFashion -> Fashion, OBeauty -> Beauty, ...).
--
-- Renamed in place rather than deleted and re-seeded. 74 products reference
-- these eight rows by `brandId`; deleting the rows would either cascade or
-- orphan them, and re-seeding under a new slug would leave eight dead brand
-- rows behind and double the house-brand list.
--
-- `updatedAt` is set by hand because Prisma's @updatedAt is applied by the
-- client, not by the database.
--
-- The frozen reference (oshoppingbd.html) still says OFashion. That is
-- expected: the rename lives at the brand layer, never in the reference file.

UPDATE `Brand` SET `slug` = 'fashion',   `nameEn` = 'Fashion',   `nameBn` = 'Fashion',   `updatedAt` = NOW(3) WHERE `slug` = 'ofashion';
UPDATE `Brand` SET `slug` = 'beauty',    `nameEn` = 'Beauty',    `nameBn` = 'Beauty',    `updatedAt` = NOW(3) WHERE `slug` = 'obeauty';
UPDATE `Brand` SET `slug` = 'fragrance', `nameEn` = 'Fragrance', `nameBn` = 'Fragrance', `updatedAt` = NOW(3) WHERE `slug` = 'ofragrance';
UPDATE `Brand` SET `slug` = 'gadgets',   `nameEn` = 'Gadgets',   `nameBn` = 'Gadgets',   `updatedAt` = NOW(3) WHERE `slug` = 'ogadgets';
UPDATE `Brand` SET `slug` = 'nature',    `nameEn` = 'Nature',    `nameBn` = 'Nature',    `updatedAt` = NOW(3) WHERE `slug` = 'onature';
UPDATE `Brand` SET `slug` = 'home',      `nameEn` = 'Home',      `nameBn` = 'Home',      `updatedAt` = NOW(3) WHERE `slug` = 'ohome';
UPDATE `Brand` SET `slug` = 'food',      `nameEn` = 'Food',      `nameBn` = 'Food',      `updatedAt` = NOW(3) WHERE `slug` = 'ofood';
UPDATE `Brand` SET `slug` = 'books',     `nameEn` = 'Books',     `nameBn` = 'Books',     `updatedAt` = NOW(3) WHERE `slug` = 'obooks';

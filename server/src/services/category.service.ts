/**
 * Category and brand queries.
 *
 * The category tree is two levels: 14 parents, 84 children. Counts are
 * computed with `groupBy` rather than a per-category `count()`, so the tree
 * costs three queries regardless of how many categories exist.
 */

import { prisma } from '../config/database.js';
import { PUBLISHED } from './product.service.js';
import { toBrandDto, toCategoryDto, type BrandDto, type CategoryDto } from './mappers.js';

/**
 * The full category tree with real product counts.
 *
 * Counts only include public products — a category that shows "12 products"
 * must not be counting drafts the customer can never see.
 */
export async function listCategories(): Promise<CategoryDto[]> {
  const [parents, children, productCounts] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.category.findMany({
      where: { parentId: { not: null }, isActive: true },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.product.groupBy({
      by: ['categoryId'],
      where: PUBLISHED,
      _count: { _all: true },
    }),
  ]);

  const countByCategory = new Map(
    productCounts.map((row) => [row.categoryId, row._count._all]),
  );

  const childrenByParent = new Map<string, typeof children>();
  for (const child of children) {
    if (!child.parentId) continue;
    const bucket = childrenByParent.get(child.parentId) ?? [];
    bucket.push(child);
    childrenByParent.set(child.parentId, bucket);
  }

  /**
   * A parent's product count is its own products plus its children's, because
   * the storefront's category page lists everything under the parent.
   */
  return parents.map((parent) => {
    const kids = childrenByParent.get(parent.id) ?? [];
    const own = countByCategory.get(parent.id) ?? 0;
    const childTotal = kids.reduce((sum, kid) => sum + (countByCategory.get(kid.id) ?? 0), 0);

    return toCategoryDto({ ...parent, children: kids }, own + childTotal, countByCategory);
  });
}

/** One category by slug, with its products. Null when unknown or inactive. */
export async function getCategoryBySlug(slug: string) {
  const row = await prisma.category.findFirst({
    where: { slug, isActive: true },
    include: {
      children: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!row) return null;

  const counts = await prisma.product.groupBy({
    by: ['categoryId'],
    where: PUBLISHED,
    _count: { _all: true },
  });
  const countByCategory = new Map(counts.map((c) => [c.categoryId, c._count._all]));

  const own = countByCategory.get(row.id) ?? 0;
  const childTotal = row.children.reduce(
    (sum, kid) => sum + (countByCategory.get(kid.id) ?? 0),
    0,
  );

  return toCategoryDto(row, own + childTotal, countByCategory);
}

/** Every active brand with its public product count. */
export async function listBrands(): Promise<BrandDto[]> {
  const [brands, counts] = await Promise.all([
    prisma.brand.findMany({
      where: { isActive: true },
      orderBy: [{ isOwnBrand: 'desc' }, { sortOrder: 'asc' }],
    }),
    prisma.product.groupBy({
      by: ['brandId'],
      where: PUBLISHED,
      _count: { _all: true },
    }),
  ]);

  const countByBrand = new Map(
    counts.filter((c) => c.brandId).map((c) => [c.brandId as string, c._count._all]),
  );

  return brands.map((brand) => toBrandDto(brand, countByBrand.get(brand.id) ?? 0));
}

/** One brand by slug. Null when unknown or inactive. */
export async function getBrandBySlug(slug: string): Promise<BrandDto | null> {
  const row = await prisma.brand.findFirst({ where: { slug, isActive: true } });
  if (!row) return null;

  const count = await prisma.product.count({ where: { ...PUBLISHED, brandId: row.id } });
  return toBrandDto(row, count);
}

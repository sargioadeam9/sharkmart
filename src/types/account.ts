/**
 * Wire types for the account surface — auth, addresses, cart, orders.
 *
 * These mirror `server/src/services/*.ts` DTOs exactly. They are hand-written
 * rather than imported because the two packages have no shared build: the
 * server is a separate Node project with its own tsconfig, and a cross-package
 * import would drag Prisma types into the browser bundle.
 *
 * Rule: if a field changes on the server, it changes here in the same commit
 * (AGENTS.md §5.1, "shared contracts").
 */

// ─── Auth ────────────────────────────────────────────────────────────────

export type UserRole = 'CUSTOMER' | 'STAFF' | 'ADMIN' | 'SUPER_ADMIN';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  phone?: string;
}

export interface LoginInput {
  /** Email or phone — the server normalises both. */
  identifier: string;
  password: string;
}

// ─── Addresses ───────────────────────────────────────────────────────────

export interface AddressDto {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  address: string;
  postalCode: string | null;
  isDefault: boolean;
}

export interface AddressInput {
  label?: string;
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  address: string;
  postalCode?: string;
  isDefault?: boolean;
}

// ─── Cart ────────────────────────────────────────────────────────────────

export interface ServerCartLine {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  slug: string;
  sku: string;
  nameEn: string;
  nameBn: string;
  imageUrl: string | null;
  /** Live price from the DB — never a client value. */
  unitPricePoisha: number;
  originalUnitPricePoisha: number;
  stockQuantity: number;
  /** Requested quantity exceeds stock. The UI must warn and block checkout. */
  insufficientStock: boolean;
  /** Product or variant is no longer purchasable. */
  unavailable: boolean;
  variantNameEn: string | null;
  variantNameBn: string | null;
}

export interface ServerCart {
  lines: ServerCartLine[];
  itemCount: number;
  subtotalPoisha: number;
  hasIssues: boolean;
}

// ─── Checkout ────────────────────────────────────────────────────────────

export type DeliveryMethod = 'STANDARD' | 'EXPRESS';
export type PaymentMethod = 'COD' | 'BKASH' | 'NAGAD' | 'SSLCOMMERZ';

export interface CheckoutItemInput {
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface CheckoutAddressInput {
  recipientName: string;
  phone: string;
  division: string;
  district: string;
  area: string;
  address: string;
  postalCode?: string;
}

export interface CheckoutInput {
  items: CheckoutItemInput[];
  addressId?: string;
  address?: CheckoutAddressInput;
  deliveryMethod?: DeliveryMethod;
  paymentMethod?: PaymentMethod;
  couponCode?: string;
  notes?: string;
  guestPhone?: string;
  guestName?: string;
  /** Optional receipt address; the order is valid without one. */
  contactEmail?: string;
}

// ─── Orders ──────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export interface OrderLineDto {
  id: string;
  productId: string;
  variantId: string | null;
  nameEn: string;
  nameBn: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
  lineTotalPoisha: number;
  returnStatus: string | null;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  subtotalPoisha: number;
  discountAmountPoisha: number;
  deliveryChargePoisha: number;
  totalAmountPoisha: number;
  paidAmountPoisha: number;
  couponCode: string | null;
  createdAt: string;
  items: OrderLineDto[];
  shippingAddress: CheckoutAddressInput | null;
  statusHistory: Array<{ status: string; note: string | null; createdAt: string }>;
  trackingUrl: string | null;
  courierName: string | null;
  consignmentId: string | null;
}

/** The public tracking view — deliberately has no internal id. */
export interface TrackedOrder {
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: string;
  createdAt: string;
  totalAmountPoisha: number;
  items: Array<{
    nameEn: string;
    nameBn: string;
    quantity: number;
    lineTotalPoisha: number;
  }>;
  statusHistory: Array<{ status: string; note: string | null; createdAt: string }>;
  trackingUrl: string | null;
  courierName: string | null;
  consignmentId: string | null;
  shippingAddress: {
    recipientName: string;
    division: string;
    district: string;
    area: string;
  } | null;
}

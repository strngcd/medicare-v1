# Medicar API reference (v1)

Base path: `/api/v1`. All requests and responses are JSON (except exports).

## Conventions

### Response envelope

```json
{ "success": true, "data": {}, "message": "Operation completed successfully." }
```

Collections:

```json
{ "success": true, "data": [], "pagination": { "page": 1, "limit": 25, "total": 240, "totalPages": 10 } }
```

Errors:

```json
{ "success": false, "error": { "code": "INSUFFICIENT_STOCK", "message": "Insufficient stock for this medicine.", "details": {} } }
```

Validation errors (`422`) list field messages in `error.details.fields`
(nested fields use dotted paths, e.g. `items.0.quantity`).

### Status codes

`200` success · `201` created · `400` malformed · `401` unauthenticated ·
`403` unauthorized · `404` not found · `409` conflict / business rule ·
`422` validation · `429` rate limited · `500` unexpected (never exposes internals).

### Pagination, sorting, filtering

- `page` (default 1), `limit` (default 25, max 100)
- `sortBy` must be one of the endpoint's whitelisted fields (others fall back to the default); `sortOrder` = `asc` | `desc`
- Dates are `YYYY-MM-DD` in the business calendar (`BUSINESS_TIMEZONE`)
- Money is sent and returned as decimal strings with two decimals (`"12.50"`)

### Authentication and CSRF

`POST /auth/login` sets two cookies:

- `medicar_sid` — HttpOnly session cookie
- `medicar_csrf` — readable token; send it back as `X-CSRF-Token` on every
  `POST`/`PUT`/`PATCH`/`DELETE`

State-changing requests must use `Content-Type: application/json`, except file
uploads: those `PUT` the raw file as the body with its own type (`image/png`,
`image/jpeg`, `image/webp` or `application/pdf`) and the file name, URL-encoded,
in `X-File-Name`. The server checks the file's real type from its bytes. Files
are stored in the database and are never modified; a replacement is a new file.

### Branch scope

Endpoints that accept `branchId` require access to that branch. Without it,
Owners see all branches and other users see their assigned branches.

### Financial visibility

Without `FINANCIAL_VIEW_PURCHASE_COST` the server omits purchase prices,
cost, inventory value and purchase amounts. Without `FINANCIAL_VIEW_PROFIT`
it omits COGS, gross profit and margins. This applies to every endpoint,
including reports, exports and search.

### Idempotency

These endpoints accept an `Idempotency-Key` header (8–200 URL-safe chars):

`POST /sales`, `POST /sales/:id/void`, `POST /refunds`, `POST /purchases/:id/receive`,
`POST /inventory/adjustments`, `POST /inventory/stock`, `POST /transfers/:id/ship`,
`POST /transfers/:id/receive`, `POST /supplier-payments`

Repeating a request with the same key returns the original result with the
header `Idempotent-Replayed: true`. Reusing a key with a different body
returns `409 IDEMPOTENCY_KEY_REUSED`. A failed attempt does not consume the key.

---

## Endpoints

Permission codes are listed per endpoint ("any of" where noted).

### Authentication

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | `{ email, password }`. Generic `INVALID_CREDENTIALS`; `ACCOUNT_INACTIVE`; `RATE_LIMITED` (429). Returns the session payload. |
| POST | `/auth/logout` | Revokes the current session. |
| POST | `/auth/forgot-password` | `{ email }`. Always 200; sends a single-use link if the account is active. |
| POST | `/auth/reset-password` | `{ token, password }`. Also completes account setup. Signs out all sessions. `INVALID_RESET_TOKEN`. |
| POST | `/auth/change-password` | `{ currentPassword, newPassword }`. Signs out other sessions. `INVALID_CURRENT_PASSWORD`. |
| GET | `/auth/me` | Session payload: user, role, permissions, branches, selected branch, preferences, and operational pharmacy settings (name, currency, tax). |

### Users (staff)

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/users` | STAFF_VIEW | Filters: `search, role, status, branchId`. Non-Owners see staff sharing a branch (and Owners). |
| POST | `/users` | STAFF_CREATE | `{ fullName, email, roleCode, branchIds, phone?, employeeId?, jobTitle?, hireDate? }`. Returns `setupLink`. |
| GET | `/users/:id` | STAFF_VIEW | |
| PATCH | `/users/:id` | STAFF_EDIT | Profile fields. Not for yourself. |
| PATCH | `/users/:id/role` | STAFF_CHANGE_ROLE | `{ roleCode }`. Non-Owners assign only roles below their own. |
| PATCH | `/users/:id/branches` | STAFF_MANAGE_BRANCHES | `{ branchIds }`. Non-Owners change only their own branches' assignments. |
| GET | `/users/:id/permissions` | STAFF_VIEW | Each permission: `inherited`, `override` (`GRANT`/`DENY`/null), `effective`, `canModify`. |
| PUT | `/users/:id/permissions/:code` | STAFF_MANAGE_PERMISSIONS | `{ granted: true|false }`. You can only manage permissions you hold. |
| DELETE | `/users/:id/permissions/:code` | STAFF_MANAGE_PERMISSIONS | Back to inherited. |
| POST | `/users/:id/deactivate` | STAFF_DEACTIVATE | Revokes sessions. |
| POST | `/users/:id/reactivate` | STAFF_REACTIVATE | |
| POST | `/users/:id/setup-link` | STAFF_CREATE | Reissues the setup link for an account without a password. |
| GET | `/users/:id/cv` | STAFF_VIEW | The staff member's CV (PDF, inline; `?download=1` for attachment). Staff records carry `cv` metadata or `null`. |
| PUT, DELETE | `/users/:id/cv` | STAFF_CREATE or STAFF_EDIT | Upload (PDF, max 5 MB) or remove the CV. Needs authority over the user (or self). |
| GET | `/users/:id/activity` | STAFF_VIEW + AUDIT_LOG_VIEW | Audit entries by the user. |
| GET, PATCH | `/users/me` | signed in | Self-service: `fullName`, `phone` only. |
| GET, PATCH | `/users/me/preferences` | signed in | `{ theme, pageSize, uiDensity, lastSelectedBranchId }`. |

Users can never change their own role, permissions, branches, status or employee ID.

### Branches

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/branches/context` | signed in | Branches for the selector; `transferDestinations` for transfer creators. |
| GET | `/branches` | BRANCH_VIEW | |
| POST | `/branches` | BRANCH_CREATE | `code` is normalized to upper case and immutable. |
| GET, PATCH | `/branches/:id` | BRANCH_VIEW / BRANCH_EDIT | |
| POST | `/branches/:id/deactivate` | BRANCH_DEACTIVATE | `BRANCH_HAS_DEPENDENT_STAFF`, `BRANCH_HAS_TRANSFERS_IN_TRANSIT`. |
| POST | `/branches/:id/reactivate` | BRANCH_REACTIVATE | |
| GET | `/branches/:id/users` | BRANCH_VIEW + STAFF_VIEW | |
| GET | `/branches/:id/inventory-summary` | INVENTORY_VIEW | |
| GET, PATCH | `/branches/:id/settings` | SETTINGS_VIEW or BRANCH_EDIT / SETTINGS_EDIT or BRANCH_EDIT | Receipt options, default minimum stock (new records only). |

### Medicines, cosmetics and categories

Medicines and cosmetics are both products (`productType`: `MEDICINE` | `COSMETIC`)
in `/medicines`, sharing purchasing, inventory, sales, refunds, transfers and
reports. The type is set on create and never changes; categories have a type too
and a product only takes a category of its own type. Cosmetics never require a
prescription (the flag may be omitted). Their batches may omit `batchNumber`
(a `LOT-XXXXXX` code is generated) and `expiryDate` (stored as `9999-12-31`,
meaning no expiry: never expiring, sold after dated stock). Medicines always need both.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/medicines` | MEDICINE_VIEW | Filters: `search, productType, categoryId, status, prescriptionRequired, branchId`. Includes sellable stock. |
| GET | `/medicines/search` | MEDICINE_VIEW | POS search: `q, branchId, categoryId, productType`. Active medicines, sellable quantity, next FEFO price, `barcodeMatch`. |
| POST | `/medicines` | MEDICINE_CREATE | Created as `DRAFT`. Returns `warnings.duplicates`. |
| GET, PATCH | `/medicines/:id` | MEDICINE_VIEW / MEDICINE_EDIT | PATCH `{ status: "ACTIVE" }` activates a draft. |
| PATCH | `/medicines/:id/barcode` | MEDICINE_EDIT | `{ barcode | null }`. `DUPLICATE_BARCODE`. |
| POST | `/medicines/:id/archive` · `/restore` | MEDICINE_ARCHIVE · MEDICINE_RESTORE | |
| GET | `/medicines/:id/batches` | INVENTORY_VIEW_BATCHES | |
| GET | `/medicines/:id/inventory` | INVENTORY_VIEW | |
| GET | `/medicine-categories` | CATEGORY_VIEW | Filters `status, productType, search`. |
| POST, PATCH | `/medicine-categories[/:id]` | CATEGORY_CREATE / CATEGORY_EDIT | POST takes `productType` (default `MEDICINE`). `DUPLICATE_CATEGORY`. |
| POST | `/medicine-categories/:id/archive` · `/restore` | CATEGORY_ARCHIVE · CATEGORY_RESTORE | |

### Inventory

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/inventory` | INVENTORY_VIEW | Rows per branch × batch with derived `status`; filter `productType`. Batch details need INVENTORY_VIEW_BATCHES. |
| GET | `/inventory/:id` | INVENTORY_VIEW | |
| GET | `/inventory/expired` · `/expiring-soon` | INVENTORY_VIEW | Per batch row. |
| GET | `/inventory/low-stock` · `/out-of-stock` | INVENTORY_VIEW | Per medicine and branch (sellable = non-expired stock). |
| POST | `/inventory/stock` | INVENTORY_ADD_STOCK | Opening stock / medicine setup. `BATCH_COST_CONFLICT`, `BATCH_DATA_CONFLICT`, `BATCH_EXPIRED`. |
| POST | `/inventory/adjustments/preview` | INVENTORY_ADJUST | `{ inventoryId, reason, quantityChange, notes? }` |
| POST | `/inventory/adjustments` | INVENTORY_ADJUST | Same body + optional `expectedQuantityBefore` (`STOCK_CHANGED` if stale). STK number. |
| PATCH | `/inventory/:id/minimum-stock` · `/selling-price` | INVENTORY_ADJUST | Audited. |
| POST | `/inventory/:id/dispose` | INVENTORY_DISPOSE | `{ notes?, archive?, recordAsLoss? }`. Removes all remaining units (STK number); counted as a loss unless `recordAsLoss: false`. Expired or expiring batches need no reason; in-date batches require `notes`. Idempotent. |
| POST | `/inventory/fefo-preview` | SALES_CREATE or INVENTORY_VIEW | Non-binding allocation preview. |
| GET | `/inventory/movements[/:id]` | INVENTORY_VIEW_MOVEMENTS | Immutable ledger; filters `batchId, medicineId, movementType, referenceType, referenceId, dateFrom, dateTo`. |
| GET | `/batches[/:id]` | INVENTORY_VIEW_BATCHES | |
| GET | `/batches/:id/movements` | INVENTORY_VIEW_MOVEMENTS | |

Adjustment reasons map to movement types: DAMAGED→DAMAGED, EXPIRED→EXPIRED,
LOST→LOST, FOUND→CORRECTION, CORRECTION→CORRECTION, OTHER→ADJUSTMENT.

### Suppliers, purchases and payments

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET, POST | `/suppliers` | SUPPLIER_VIEW / SUPPLIER_CREATE | Similar names return `warnings.similarSuppliers`. |
| GET, PATCH | `/suppliers/:id` | SUPPLIER_VIEW / SUPPLIER_EDIT | |
| POST | `/suppliers/:id/archive` · `/restore` | SUPPLIER_ARCHIVE · SUPPLIER_RESTORE | |
| GET | `/suppliers/:id/purchases` | PURCHASE_VIEW | |
| GET | `/suppliers/:id/balance` | SUPPLIER_PAYMENT_VIEW | Derived per branch. |
| GET, POST | `/purchases` | PURCHASE_VIEW / PURCHASE_CREATE | Create: `{ supplierId, branchId, status?, purchaseDate?, expectedDate?, notes?, items[] }`. |
| GET, PATCH | `/purchases/:id` | PURCHASE_VIEW / PURCHASE_EDIT | Edit only in DRAFT/PENDING. |
| POST | `/purchases/:id/receive` | PURCHASE_RECEIVE | `{ items: [{ purchaseItemId, batchNumber, manufacturingDate?, expiryDate, quantity, purchasePrice?, sellingPrice }] }`. `OVER_RECEIVING`, `BATCH_COST_CONFLICT`, `PURCHASE_ALREADY_RECEIVED`. |
| GET | `/purchases/:id/receivings` | PURCHASE_VIEW | |
| GET | `/purchase-receivings/:id` | PURCHASE_VIEW | |
| POST | `/purchases/:id/cancel` | PURCHASE_CANCEL | `{ reason }`. Only before any receipt or payment. |
| GET | `/supplier-payments[/:id]` | SUPPLIER_PAYMENT_VIEW | |
| POST | `/supplier-payments` | SUPPLIER_PAYMENT_CREATE | `{ purchaseId, amount, paymentMethod, referenceNumber?, notes?, paidAt? }`. `OVERPAYMENT_NOT_ALLOWED`. |

### Sales and refunds

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | `/sales` | SALES_CREATE | `{ branchId, items: [{ medicineId, quantity, batchAllocations?, fefoOverrideReason? }], discount?: { type, value }, paymentMethod, amountPaid }`. Prices, FEFO, discount, tax and totals are server-calculated. `INSUFFICIENT_STOCK`, `INVALID_PAYMENT_AMOUNT` (details include the exact `total`), `MEDICINE_ARCHIVED`. Discounts need SALES_APPLY_DISCOUNT; batch overrides need SALES_OVERRIDE_FEFO and a reason. |
| GET | `/sales` | SALES_VIEW_HISTORY | Filters: `branchId, staffId, medicineId, categoryId, paymentMethod, status, receiptNumber, dateFrom, dateTo, minAmount, maxAmount`. |
| GET | `/sales/my` | SALES_VIEW or SALES_CREATE | Own sales. |
| GET | `/sales/:id` | SALES_VIEW or SALES_VIEW_HISTORY | Without history permission only own sales are visible. |
| GET | `/sales/:id/receipt` | SALES_PRINT_RECEIPT | Historical values plus branch receipt options. |
| POST | `/sales/:id/void` | SALES_VOID | `{ reason }`. Restores exact batches. `SALE_ALREADY_VOIDED`, `SALE_HAS_REFUNDS`. |
| GET | `/refunds[/:id]` | SALES_VIEW_HISTORY or SALES_PROCESS_REFUND | |
| POST | `/refunds` | SALES_PROCESS_REFUND | `{ saleId, reason, notes?, items: [{ saleItemId, quantity }] }`. `REFUND_EXCEEDS_REMAINING`, `SALE_NOT_REFUNDABLE`. Paid with the sale's payment method. |

### Transfers

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/transfers[/:id]` | INVENTORY_TRANSFER_VIEW | Visible if you belong to either branch. |
| POST | `/transfers` | INVENTORY_TRANSFER_CREATE | `{ sourceBranchId, destinationBranchId, items: [{ batchId, requestedQuantity }] }` |
| POST | `/transfers/:id/request` | INVENTORY_TRANSFER_CREATE | DRAFT → REQUESTED |
| POST | `/transfers/:id/approve` | INVENTORY_TRANSFER_APPROVE | Source branch staff. Optional `items: [{ transferItemId, quantity }]`. |
| POST | `/transfers/:id/ship` | INVENTORY_TRANSFER_SHIP | Source branch staff. Decreases source stock. `TRANSFER_INSUFFICIENT_STOCK`. |
| POST | `/transfers/:id/receive` | INVENTORY_TRANSFER_RECEIVE | Destination branch staff. Shortfalls need `discrepancyReason`. |
| POST | `/transfers/:id/cancel` | INVENTORY_TRANSFER_CREATE or _APPROVE | `{ reason }`. Before shipment only. |

Invalid steps return `TRANSFER_INVALID_STATE`.

### Alerts and notifications

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/alerts` | ALERT_VIEW | Derived; filters `branchId, type, severity`. |
| GET | `/alerts/count` | ALERT_VIEW | Totals by type and severity. |
| GET | `/alerts/:id` | ALERT_VIEW | 404 once resolved. |
| GET | `/notifications` | NOTIFICATION_VIEW | Own only; `unreadOnly`. |
| GET | `/notifications/unread-count` | NOTIFICATION_VIEW | |
| PATCH | `/notifications/:id/read` · `/:id/dismiss` · `/read-all` | NOTIFICATION_VIEW | |

### Reports, analytics and exports

Date parameters: `range` = `TODAY|WEEK|MONTH|YEAR|CUSTOM` with `dateFrom`/`dateTo` for CUSTOM. Future dates return 422.
Sales, profit and inventory reports (and their exports) accept `productType` = `MEDICINE|COSMETIC`;
for sales and profit it keeps sales containing at least one item of that type, like `categoryId`.
Exports show the no-expiry date as "No expiry".

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/reports/sales` | REPORT_SALES_VIEW |
| GET | `/reports/profit` | REPORT_PROFIT_VIEW + FINANCIAL_VIEW_PROFIT |
| GET | `/reports/inventory` | REPORT_INVENTORY_VIEW |
| GET | `/reports/inventory/movements` | REPORT_INVENTORY_VIEW |
| GET | `/reports/purchases` | REPORT_PURCHASE_VIEW |
| GET | `/reports/suppliers` | REPORT_SUPPLIER_VIEW |
| GET | `/reports/{sales,profit,inventory,purchases,suppliers}/export?format=csv|pdf` | REPORT_EXPORT + the report's permissions |
| GET | `/analytics/dashboard` · `/sales-trend` · `/top-medicines` · `/sales-by-category` · `/inventory` · `/branch-comparison` | DASHBOARD_VIEW (financial KPIs: DASHBOARD_VIEW_FINANCIALS; profit KPIs: DASHBOARD_VIEW_PROFIT) |

Definitions: completed sales count; voided sales are excluded (reported
separately); refunds reduce revenue and COGS on their refund date; revenue
excludes tax; COGS uses `purchase_price_at_sale` of the exact batches sold.

### Audit, settings, help and search

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/audit-logs[/:id]` | AUDIT_LOG_VIEW | Filters `userId, branchId, action, entityType, entityId, dateFrom, dateTo, search`. |
| GET | `/audit-logs/actions` | AUDIT_LOG_VIEW | Distinct action codes. |
| GET | `/login-history` | LOGIN_HISTORY_VIEW | |
| GET, PATCH | `/settings` | SETTINGS_VIEW / SETTINGS_EDIT | Global pharmacy, tax and expiry settings. |
| PUT, DELETE | `/settings/logo` | SETTINGS_EDIT | Upload (PNG/JPG/WebP, max 2 MB) or remove the pharmacy logo. `logoUrl` in settings, branding and receipts points to it. |
| GET | `/branding/logo` | public | The current logo image (shown on the sign-in page). |
| GET | `/system/info` | SETTINGS_VIEW | Version, schema, business date, numbering state. |
| GET | `/help` · `/help/search?q=` · `/help/:idOrSlug` | signed in | Published articles only. |
| GET | `/search?q=&branchId=` | signed in | Global search; each group requires its own view permission. |

### Error codes

Authentication: `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `ACCOUNT_INACTIVE`,
`RATE_LIMITED`, `CSRF_TOKEN_INVALID`, `INVALID_RESET_TOKEN`, `INVALID_CURRENT_PASSWORD`.

Authorization: `PERMISSION_DENIED`, `BRANCH_ACCESS_DENIED`, `INSUFFICIENT_AUTHORITY`,
`SELF_MODIFICATION_NOT_ALLOWED`, `OWNER_PERMISSIONS_FIXED`, `LAST_OWNER`.

General: `VALIDATION_ERROR`, `RESOURCE_NOT_FOUND`, `ROUTE_NOT_FOUND`, `MALFORMED_REQUEST`,
`UNSUPPORTED_CONTENT_TYPE`, `FILE_REQUIRED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`, `INVALID_STATUS_TRANSITION`, `CONCURRENT_UPDATE`,
`IDEMPOTENCY_KEY_REUSED`, `INVALID_IDEMPOTENCY_KEY`, `INTERNAL_ERROR`.

Domain: `DUPLICATE_EMAIL`, `DUPLICATE_EMPLOYEE_ID`, `DUPLICATE_BARCODE`,
`DUPLICATE_CATEGORY`, `DUPLICATE_BRANCH_CODE`, `BRANCH_INACTIVE`, `BRANCH_REQUIRED`,
`BRANCH_HAS_DEPENDENT_STAFF`, `BRANCH_HAS_TRANSFERS_IN_TRANSIT`, `CATEGORY_ARCHIVED`,
`MEDICINE_ARCHIVED`, `MEDICINE_NOT_ACTIVE`, `SUPPLIER_ARCHIVED`, `BATCH_EXPIRED`,
`BATCH_COST_CONFLICT`, `BATCH_DATA_CONFLICT`, `BATCH_NOT_SELLABLE`, `INSUFFICIENT_STOCK`,
`STOCK_CHANGED`, `OVER_RECEIVING`, `PURCHASE_ALREADY_RECEIVED`, `PURCHASE_HAS_PAYMENTS`,
`PURCHASE_NOT_PAYABLE`, `TOTAL_BELOW_PAID`, `OVERPAYMENT_NOT_ALLOWED`,
`INVALID_PAYMENT_AMOUNT`, `DISCOUNT_EXCEEDS_SUBTOTAL`, `SALE_ALREADY_VOIDED`,
`SALE_HAS_REFUNDS`, `SALE_NOT_REFUNDABLE`, `REFUND_EXCEEDS_REMAINING`,
`TRANSFER_INVALID_STATE`, `TRANSFER_INSUFFICIENT_STOCK`, `ACCOUNT_ALREADY_SET_UP`.

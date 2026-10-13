/**
 * Help center articles. Bodies use a small Markdown subset rendered by the
 * client: "## " headings, "- " bullet lists, "1. " numbered lists, and paragraphs.
 * Articles describe how this application works; they must never contain
 * infrastructure details or secrets.
 */
module.exports = [
  {
    slug: 'getting-started',
    category: 'GETTING_STARTED',
    title: 'Getting started with Medicar',
    summary: 'A short tour of the main areas of the system and how they connect.',
    body: `
Medicar is the internal operations system for the pharmacy. Every screen works on live data from the database, and every important action is recorded in the audit log.

## The main areas
- Dashboard: today's activity and stock health for the selected branch.
- Medicines: the product catalog, batches and stock per branch.
- Inventory: stock levels, adjustments and the movement ledger.
- Purchasing: orders to suppliers and receiving stock into a branch.
- POS: fast point-of-sale for selling medicines.
- Sales and refunds: sales history, receipts, refunds and voids.
- Transfers: moving stock between branches.
- Reports: sales, profit, inventory, purchase and supplier reports.

## Branches
Most work happens in a branch. Use the branch selector in the header to choose where you are working. You can only select branches you are assigned to; Owners can also choose All Branches for an organization-wide view.

## What you can see
What appears in the menu depends on your role and permissions. If a page or button is missing, ask an Owner or Admin to review your permissions.
`,
  },
  {
    slug: 'roles-and-permissions',
    category: 'STAFF_PERMISSIONS',
    title: 'Roles and permissions',
    summary: 'How the four roles, individual permission overrides and branch assignments work together.',
    body: `
Access is decided by three things: your role, any permission overrides on your account, and the branches you are assigned to.

## Roles
- Owner: unrestricted access everywhere. Owner permissions cannot be removed.
- Admin: manages staff, catalog and operations. Admin permissions can be customized.
- Pharmacist: manages medicines, stock and purchasing, and can sell and refund.
- Cashier: sells, prints receipts and processes refunds.

## Permission overrides
Each permission on a staff member is shown as one of:
- Inherited: the role decides.
- Explicit grant: allowed even if the role does not include it.
- Explicit deny: blocked even if the role includes it.

Removing an override returns the permission to Inherited.

## Branch assignments
Permissions decide what you can do; branch assignments decide where. A Pharmacist assigned only to the Bole branch can manage stock in Bole but not in any other branch.

## Rules that always apply
- Nobody can change their own role, permissions or branches.
- Admins cannot modify an Owner or grant permissions they do not hold themselves.
- Financial values such as purchase cost and profit are only sent to users with the financial visibility permissions.
`,
  },
  {
    slug: 'adding-a-medicine',
    category: 'MEDICINES',
    title: 'Adding a medicine',
    summary: 'The two-step flow: save the medicine as a draft, then add its first batches.',
    body: `
Adding a medicine is done in two steps.

## Step 1: Medicine information
Enter the name, package size and whether a prescription is required. Generic name, brand, category, strength, dosage form, barcode and storage instructions are optional. Saving creates the medicine as a Draft.

If a medicine with the same name, strength, dosage form and package size already exists, you will see a warning. Check the existing record before continuing.

## Step 2: Batches
Add one or more batches with batch number, expiry date, purchase price, selling price, quantity, supplier and branch. When you finish, the medicine becomes Active and can be sold.

## Barcodes
Each medicine can have one barcode, and a barcode can belong to only one medicine.

## Archiving
Archived medicines cannot be sold or purchased, but all their history remains. They can be restored later.
`,
  },
  {
    slug: 'batches-and-expiry',
    category: 'INVENTORY',
    title: 'Batches, expiry and stock status',
    summary: 'How batches, branch stock and stock statuses such as low stock and expiring soon are determined.',
    body: `
Stock is tracked per batch and per branch. The same batch can be stocked in several branches, each with its own quantity, minimum stock and selling price. The purchase price belongs to the batch and never changes.

## Stock status
- Expired: the expiry date is before today. Expired stock cannot be sold.
- Expiring soon: the batch expires within the warning period set in Settings (30 days by default).
- Out of stock: no sellable (non-expired) quantity remains.
- Low stock: sellable quantity is at or below the minimum stock level.
- Available: none of the above.

Out of stock takes precedence over low stock. Expired stock stays visible in inventory until it is disposed of.

## Disposing of expired or expiring stock
Owners, Admins and Pharmacists can dispose of a batch that has expired or is expiring soon, from Inventory alerts or from the batch's actions in Inventory. All remaining units leave stock with a Disposed movement. Their purchase cost is recorded as a loss: see the Stock losses report, and Stock losses and Net profit on the Profit report. The batch and its history are kept.

## Archiving batches
A batch with no stock left in a branch can be archived to hide it from stock lists. Tick "Archived batches" in Inventory to see archived batches and restore them. If the same batch is received again, it is restored automatically.

## Alerts
Inventory alerts are calculated from current stock. They cannot be dismissed; they disappear when the condition is resolved, for example by receiving stock or disposing of expired stock.
`,
  },
  {
    slug: 'fefo',
    category: 'INVENTORY',
    title: 'FEFO: first-expired, first-out',
    summary: 'Why the POS sells the batch that expires first, and how overrides work.',
    body: `
When you sell a medicine, the system automatically takes stock from the non-expired batch that expires first. This reduces waste from expired stock.

## How allocation works
If the earliest batch does not have enough quantity, the remaining units come from the next batch, and so on. The final allocation is always calculated by the server at the moment the sale is completed, so two cashiers selling at the same time can never sell the same unit twice.

## Overriding FEFO
Users with the FEFO override permission can choose specific batches, for example when a customer asks for a particular batch. A reason is required. The original recommendation, the actual allocation and the reason are recorded.
`,
  },
  {
    slug: 'minimum-stock',
    category: 'INVENTORY',
    title: 'Minimum stock levels',
    summary: 'How minimum stock works per branch and how the branch default is applied.',
    body: `
Minimum stock is the quantity at which a branch wants to be warned that stock is running low.

- Minimum stock is set per branch and per batch record.
- New inventory records use the branch default from Branch settings.
- Changing the branch default does not change existing records.
- You can change the minimum stock of an existing record from the inventory page. The change is recorded in the audit log.
`,
  },
  {
    slug: 'inventory-adjustments',
    category: 'INVENTORY',
    title: 'Adjusting inventory',
    summary: 'Recording damaged, expired, lost or found stock and corrections.',
    body: `
Adjustments correct the recorded quantity of a batch in a branch.

## Reasons
- Damaged, Expired, Lost: reduce stock.
- Found: increases stock.
- Correction: increases or decreases stock to match a physical count.
- Other: either direction; a note is required.

## The flow
1. Select the batch and branch.
2. Enter the change and reason.
3. Review the preview showing the current and resulting quantity.
4. Confirm.

Stock can never go below zero. Every adjustment gets an STK number, creates a stock movement and is recorded in the audit log. Adjustments cannot be edited or deleted; make a new correction instead.
`,
  },
  {
    slug: 'purchasing-and-receiving',
    category: 'PURCHASING',
    title: 'Purchasing and receiving stock',
    summary: 'Creating purchase orders, receiving stock in one or more deliveries, and cancelling.',
    body: `
Purchases record what was ordered from a supplier for a branch. Creating a purchase does not change stock; only receiving does.

## Purchase status
- Draft: being prepared.
- Pending: ordered and waiting for delivery.
- Partially received: some items have been received.
- Received: everything ordered has been received.
- Cancelled: cancelled before anything was received.

## Receiving
For each item, enter the batch number, expiry date, quantity and selling price. The unit cost comes from the order and cannot be changed while receiving. The selling price starts at unit cost plus the default markup (15% unless changed under Settings > Inventory) and can be edited. You can receive an item in several deliveries and across several batches. You cannot receive more than was ordered.

When creating a purchase you can also tick "Receive stock now" and "Record a payment now" to receive all or part of the delivery and pay all or part of the total in the same step. If any part fails, nothing is saved.

An unsaved new purchase is kept in your browser, so you can leave the page and come back to it. It is cleared once the purchase is saved.

If the batch already exists, it is reused. Its purchase price must match: a batch cannot have two different costs, and the system rejects the receipt with a batch cost conflict.

## Cancelling
A purchase can only be cancelled before any stock has been received and before any payment is recorded.
`,
  },
  {
    slug: 'supplier-payments',
    category: 'PURCHASING',
    title: 'Supplier payments and balances',
    summary: 'Recording payments against purchases and reading supplier balances.',
    body: `
Supplier payments are recorded against a purchase.

- A purchase is Unpaid, Partially paid or Paid based on the payments recorded.
- A payment cannot exceed the remaining balance of the purchase.
- Payments do not change stock.
- Recorded payments cannot be edited or deleted.

A supplier's balance is the total of their open purchases minus payments made, calculated per branch you can access.
`,
  },
  {
    slug: 'using-the-pos',
    category: 'POS_SALES',
    title: 'Selling with the POS',
    summary: 'Searching, scanning, discounts, tax and completing a sale.',
    body: `
The POS is built for speed.

1. Search by name or scan a barcode.
2. Add the medicine to the cart and adjust the quantity.
3. Medicines that require a prescription show a warning. Check the prescription before continuing.
4. Apply a discount if you have permission. Discounts can be a percentage or a fixed amount.
5. Review the subtotal, discount, tax and total.
6. Choose Cash or Bank transfer. The payment must equal the total.
7. Complete the sale and print the receipt.

## Prices and stock
Selling prices come from the branch's inventory. Items in the cart do not reserve stock; availability is checked again when the sale is completed. If stock ran out in the meantime, the sale is rejected and nothing is recorded.
`,
  },
  {
    slug: 'receipts-and-sales-history',
    category: 'POS_SALES',
    title: 'Receipts and sales history',
    summary: 'Finding past sales, reprinting receipts and understanding receipt numbers.',
    body: `
Every sale receives a receipt number such as SAL-7K3QX9. Numbers are random codes generated by the system and are never reused.

Use Sales history to filter by date, staff, medicine, category, payment method, status, receipt number and amount. Cashiers can use My sales to see their own sales quickly.

Receipts always reprint the values recorded at the time of sale, even if prices or tax settings have changed since.
`,
  },
  {
    slug: 'refunds-and-voids',
    category: 'REFUNDS',
    title: 'Refunds and voids',
    summary: 'Partial and full refunds, how stock is restored, and when a sale can be voided.',
    body: `
## Refunds
Refunds can cover a whole sale or specific quantities of specific items.

- You cannot refund more than the remaining refundable quantity.
- The refund uses the price recorded on the original sale.
- Stock returns to the same batches it was sold from.
- The refund is paid using the same method as the original sale.
- A reason is required; Other also requires a note.

Each refund receives a number such as REF-4M8TQ2.

## Finding and exporting refunds
The Refunds page filters by reason, date range and amount (minimum and maximum). Users with the export permission can download exactly the filtered list as CSV or PDF; the same report is also under Reports > Refunds.

## Voids
Voiding cancels a completed sale entirely, for example when it was entered by mistake. The exact batches are restored and the sale stays in history marked as Voided.

- A reason is always required.
- Cashiers and pharmacists can void only sales they made themselves; Owners and Admins can void any sale.
- Voided sales cannot be refunded.
- A sale that already has a refund cannot be voided.
`,
  },
  {
    slug: 'branch-transfers',
    category: 'INVENTORY',
    title: 'Transferring stock between branches',
    summary: 'The request, approval, shipment and receipt steps, and how discrepancies are handled.',
    body: `
Transfers move stock of a specific batch from one branch to another.

## Steps
1. Draft: choose source, destination, batches and quantities.
2. Requested: the transfer is submitted.
3. Approved: the source branch approves quantities, up to the requested amount.
4. In transit: the source ships. Stock leaves the source branch now.
5. Received: the destination confirms what arrived. Stock enters the destination now.

## Discrepancies
If fewer units arrive than were shipped, only the received quantity enters the destination. The difference is recorded as a discrepancy with a required reason for investigation. Missing stock is never created automatically.

A transfer can be cancelled until it is shipped.
`,
  },
  {
    slug: 'reports-overview',
    category: 'REPORTS',
    title: 'Reports and exports',
    summary: 'What each report shows, how refunds and voids are counted, and exporting.',
    body: `
## Available reports
- Sales: totals, transactions, items sold, payment methods, discounts and tax.
- Profit: revenue, cost of goods sold and gross profit (financial permission required).
- Inventory: stock and value per branch.
- Inventory movements: the full stock movement ledger.
- Purchases and suppliers: purchasing activity, payments and balances.

## How numbers are calculated
- Only completed sales count. Voided sales are excluded.
- Refunds reduce revenue and cost of goods sold.
- Cost of goods sold uses the purchase price of the exact batches sold.
- Inventory value is quantity multiplied by batch purchase cost.

## Exports
Exports use the same filters and permissions as the report on screen. Exporting never reveals values you cannot see in the report.
`,
  },
  {
    slug: 'managing-branches',
    category: 'BRANCHES',
    title: 'Managing branches',
    summary: 'Creating, editing and deactivating branches and branch settings.',
    body: `
Each branch has a name, a short code, contact details and a status.

- The branch code cannot be changed after creation.
- Inactive branches cannot make sales, receive purchases or stock, or receive new staff assignments. Their history remains available.
- Branch settings control receipt content and the default minimum stock for new inventory records.
`,
  },
  {
    slug: 'settings-overview',
    category: 'SETTINGS',
    title: 'Settings',
    summary: 'Global pharmacy settings, tax, branch settings and your own preferences.',
    body: `
Settings are grouped so that global, branch and personal settings stay separate.

## Global settings
Pharmacy name and contact details, currency, the expiry warning period, and tax.

## Tax
Tax can be enabled with a name and rate, and set to Included in prices or Added on top. Changes apply to new sales only; past sales keep the tax recorded when they were made.

## Branch settings
Receipt options and the default minimum stock for new inventory records.

## Your preferences
Theme (light, dark or system), table page size and display density. These only affect your own account.
`,
  },
  {
    slug: 'account-and-password',
    category: 'GETTING_STARTED',
    title: 'Your account and password',
    summary: 'Setting up your password, changing it, and resetting a forgotten password.',
    body: `
New staff receive a one-time setup link to choose their own password. Nobody else ever sees your password.

## Changing your password
Open your profile and choose Change password. You must enter your current password. Changing your password signs out your other sessions.

## Forgotten password
Use Forgot password on the sign-in page. If the address belongs to an active account, a reset link is sent. Links expire and can be used once. Resetting signs out all sessions.

## Signing out
Sessions do not time out automatically. Always sign out on shared computers.
`,
  },
];

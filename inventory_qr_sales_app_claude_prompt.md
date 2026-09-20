# Inventory, QR Product Catalog & Sales Management Application

## Role

You are acting as a **senior full-stack architect and engineer**.

Build a production-quality but intentionally simple web application for a small business. Only approximately 2–3 internal users will manage the system, and the application will be hosted on Railway.

The application must be **mobile-first**, because most inventory operations will happen from mobile phones.

Do **not** over-engineer this system with microservices, Kafka, Kubernetes, Redis, event buses, etc. This is a small internal application. Prefer a clean modular monolith with a simple architecture that is easy to maintain.

The application should support:

1. Product/inventory management
2. QR code generation
3. Public product pages accessible by scanning QR codes
4. Mobile QR/barcode scanning
5. Selling products through a scan-first workflow
6. Automatic inventory updates after sales
7. Sales history
8. Profit/revenue reporting
9. Product photos
10. User authentication
11. CSV import/export
12. Basic dashboard
13. Railway deployment
14. PostgreSQL database

---

# 1. Preferred Technology Stack

Use the following stack unless there is a strong technical reason to change something.

## Frontend

Use:

- Next.js
- TypeScript
- Tailwind CSS
- Responsive/mobile-first UI
- Modern component architecture
- Clean minimal UI
- Use a component library such as shadcn/ui if useful

The application should look modern and polished without unnecessary visual complexity.

The primary users will use mobile phones, so design for:

- iPhone
- Android
- Mobile Chrome
- Mobile Safari

Desktop should still work.

## Backend

Prefer a simple architecture.

Recommended:

Next.js full-stack application using API routes/server actions where appropriate.

Do NOT create separate microservices.

Use a clean separation between:

- UI
- API/application services
- database/repositories
- business logic
- authentication
- file/image handling

If using Next.js server actions, keep business logic out of UI components.

---

# 2. Database

Use:

PostgreSQL

The application will eventually be deployed on Railway, so make PostgreSQL configuration compatible with Railway PostgreSQL.

Use a proper migration system.

Do NOT rely on manually creating database tables.

Every schema change should be represented through migrations.

---

# 3. Core Business Concept

There are two important concepts:

## Product

A product represents an item/SKU.

Example:

```text
SKU: SHOE-001
Product: Nike Running Shoes
Quantity: 5
Cost Price: ₹2,500
Original Price: ₹4,999
Selling Price: optional
```

## Inventory

Inventory represents how many units of a product are currently available.

If:

```text
Product: SHOE-001
Inventory: 5
```

and the user sells 2:

```text
Inventory: 3
```

The system must **never allow inventory to become negative**.

---

# 4. Product Fields

Design the database so products can contain at least:

- id
- publicIdentifier
- sku
- productName
- category
- description
- productImage
- originalPrice
- costPrice
- sellingPrice
- currentQuantity
- supplier
- location
- status
- notes
- createdAt
- updatedAt

Selling price should be nullable.

Example:

```text
Original Price = ₹5,000
Cost Price = ₹2,500
Selling Price = null
```

Later:

```text
Selling Price = ₹4,000
```

Do not rely on the product's selling price as the historical sale price.

Every sale must store its own actual sold price.

---

# 5. SKU

SKU must be unique.

Examples:

```text
ABC-1001
ABC-1002
ABC-1003
```

Prevent duplicate SKUs.

Validate and normalize SKU input.

Do not silently overwrite an existing SKU.

---

# 6. QR CODE SYSTEM

This is one of the most important features.

When a product is created, the system should automatically generate a QR code.

The QR code should point to a public URL such as:

```text
https://yourdomain.com/p/{publicIdentifier}
```

Do not expose database IDs if unnecessary.

The QR code should be downloadable.

Support:

- Download QR as PNG
- Print QR
- Display QR on product page
- Regenerate QR if necessary

There should be **one QR code per product**.

The same QR code works for both public users and authenticated staff.

---

# 7. AUTHENTICATION-AWARE QR EXPERIENCE

The same QR URL must behave differently depending on whether the visitor is authenticated.

Example:

```text
QR
 ↓
/p/abc123
 ↓
Authentication check
 ├── Not logged in
 │     ↓
 │   Public product page
 │
 └── Logged in
       ↓
     Full product page
```

Do not create separate QR codes for public and staff users.

---

# 8. PUBLIC PRODUCT PAGE — NOT LOGGED IN

If a user scans the QR code and is NOT authenticated, show a very simple public product page.

The public page should show **ONLY**:

- Product photo
- Product name
- Current selling price

Example:

```text
┌──────────────────────┐
│                      │
│    Product Photo     │
│                      │
│    Nike Shoes        │
│                      │
│       ₹4,999         │
│                      │
└──────────────────────┘
```

Do NOT show:

- Cost price
- Original/internal purchase price
- Inventory quantity
- Supplier
- Profit
- Internal notes
- Sales history
- Inventory history
- Internal SKU
- User information
- Any other internal information

The public page should not require login.

The purpose is:

> "What is this product and how much does it cost?"

---

# 9. PUBLIC PRICE BEHAVIOR

The public page should display the product's current selling price.

If a current selling price has not been configured:

```text
Price unavailable
```

or another configurable fallback.

Do NOT expose cost price as a fallback.

Example:

```text
sellingPrice = ₹4,999
```

Public:

```text
₹4,999
```

If:

```text
sellingPrice = NULL
```

Public:

```text
Price unavailable
```

---

# 10. LOGGED-IN PRODUCT PAGE

If the user is authenticated and scans the same QR code, show the full authenticated product page.

Example:

```text
--------------------------------

[ PRODUCT PHOTO ]

Nike Running Shoes

SKU: SHOE-001

Available Quantity: 5

Original Price: ₹5,999

Cost Price: ₹2,500

Current Selling Price: ₹4,999

Category: Shoes

Supplier: ABC Supplier

Location: Store A

Description:

Premium running shoes...

Notes:

...

--------------------------------

Actions:

[ SELL ]

[ EDIT ]

[ ADJUST INVENTORY ]

[ VIEW INVENTORY HISTORY ]

[ VIEW SALES ]

[ DOWNLOAD QR ]

[ PRINT QR ]

--------------------------------
```

The authenticated user should have access to all information permitted by their role.

---

# 11. IMPORTANT PUBLIC API SECURITY

The public API must NEVER return internal fields.

This is WRONG:

```json
{
  "name": "Nike Shoes",
  "sellingPrice": 4999,
  "costPrice": 2500,
  "supplier": "ABC"
}
```

with the frontend simply hiding the internal fields.

Instead, the unauthenticated response should literally contain only:

```json
{
  "name": "Nike Shoes",
  "sellingPrice": 4999,
  "imageUrl": "..."
}
```

The authenticated response can return additional fields after authorization.

The server must enforce this.

---

# 12. Product Management

Create an authenticated Products section.

Users should be able to:

- Create product
- Edit product
- View product
- Delete/archive product
- Upload/change photo
- Generate QR
- Download QR
- Print QR
- Search products
- Filter products
- Sort products

Product list should show:

- Photo
- SKU
- Name
- Category
- Quantity
- Cost
- Status

Example:

```text
Products

[Search SKU/name]

Nike Shoes
SKU: SHOE-001
Qty: 5
Cost: ₹2,500

[View]
```

---

# 13. Inventory

Inventory must be tracked carefully.

Support:

- Add inventory
- Remove inventory
- Adjust inventory
- View inventory history

Create an inventory transaction concept.

Example:

```text
INVENTORY_TRANSACTION

id
productId
type
quantity
referenceId
notes
createdBy
createdAt
```

Transaction types:

- PURCHASE / ADD
- SALE
- RETURN
- ADJUSTMENT
- DAMAGE
- OTHER

Do not simply update product quantity without recording the transaction.

---

# 14. Mobile QR Scanner

The application must support mobile camera scanning.

Primary workflow:

```text
User opens Scan

Camera opens

User points phone at QR code

QR recognized

Product identified
```

If QR corresponds to a product:

Show product information.

For authenticated users, provide:

- View Product
- Sell

If QR is scanned by a public user, open:

```text
/p/{publicIdentifier}
```

---

# 15. Sell Workflow

Create a dedicated:

```text
/sell
```

page.

This is one of the most important screens.

The workflow should be extremely fast.

Screen:

```text
--------------------------------

Sell Product

[ Scan QR ]

or

[ Enter SKU ]

--------------------------------
```

User taps:

```text
SCAN QR
```

Camera opens.

User scans product.

Show:

```text
Product photo

Product name

SKU

Available quantity: 5

Cost price: ₹2,500
```

Then:

```text
Quantity to sell:

[-] 1 [+]

or numeric input

Sold price per unit:

₹ ______

Total:

₹ ______

Cost:

₹ ______

Profit:

₹ ______

[ COMPLETE SALE ]
```

The user enters:

- Quantity
- Sold price per unit

Then presses:

```text
COMPLETE SALE
```

---

# 16. Sale Business Logic

When completing a sale:

1. Validate product exists.
2. Validate quantity > 0.
3. Validate requested quantity <= available inventory.
4. Validate sold price >= 0.
5. Start a database transaction.
6. Create sale record.
7. Create sale line item(s).
8. Reduce inventory.
9. Create inventory transaction.
10. Calculate revenue.
11. Calculate cost.
12. Calculate profit.
13. Create audit entry.
14. Commit transaction.

If any step fails:

**ROLL BACK EVERYTHING.**

Never leave the database in a partially updated state.

---

# 17. Sales Data Model

Design the database to support future expansion.

## SALE

Fields:

- id
- saleNumber
- soldAt
- soldBy
- totalAmount
- totalCost
- totalProfit
- status
- notes
- createdAt

## SALE_ITEM

Fields:

- id
- saleId
- productId
- quantity
- costPerUnit
- soldPricePerUnit
- totalCost
- totalRevenue
- profit

A sale can contain multiple products.

Example:

```text
SALE-1001

Nike Shoes x 2
Watch x 1
Bag x 1
```

Do not assume one sale always equals one product.

---

# 18. Profit Calculation

For each sale item:

```text
totalRevenue = soldPricePerUnit × quantity

totalCost = costPerUnit × quantity

profit = totalRevenue - totalCost
```

At sale time, store the cost price used for that sale.

Do not calculate historical profit using the product's current cost price.

Example:

```text
Product cost today = ₹2,500
```

Tomorrow:

```text
Product cost = ₹2,800
```

A previous sale must still show:

```text
Cost = ₹2,500
```

Therefore SALE_ITEM must store:

```text
costPerUnit
```

---

# 19. Sale Confirmation

Before completing a sale:

```text
Product

Quantity

Sold price

Total

Cost

Profit
```

Show:

```text
Complete this sale?

[Cancel]

[Complete Sale]
```

After completion:

```text
Sale completed!

SALE-1024

Nike Shoes × 2

Revenue: ₹8,000

Profit: ₹3,000

Remaining stock: 3

[New Sale]

[View Sale]
```

---

# 20. Sale Number

Generate human-readable sale numbers.

Examples:

```text
SALE-000001
SALE-000002
SALE-000003
```

They must be unique.

---

# 21. Returns and Cancellations

Support sale status:

- COMPLETED
- CANCELLED
- RETURNED

Allow a completed sale to be cancelled/returned.

When a sale is cancelled/returned:

- Restore inventory
- Create inventory transaction
- Update sale status
- Do NOT delete the sale
- Preserve audit history

Do not physically delete completed sales.

---

# 22. Sales Page

Create:

```text
/sales
```

Show:

- Sale number
- Date/time
- Product(s)
- Quantity
- Revenue
- Cost
- Profit
- Sold by
- Status

Allow:

- Search by SKU
- Search by sale number
- Date filter
- Product filter
- User filter
- Status filter

Clicking a sale should show full sale details.

---

# 23. Dashboard

Create a simple dashboard.

Example:

```text
Dashboard

Inventory
127 units

Products
86

Sales Today
₹18,500

Sales This Month
₹2,84,500

Profit This Month
₹96,200
```

Also show:

- Recent sales
- Low-stock products
- Optional simple sales/revenue chart

Keep it visually clean.

---

# 24. Sales Reporting

Create:

```text
/reports
```

Support:

- Today
- Yesterday
- Last 7 days
- Last 30 days
- This month
- Custom date range

Show:

- Total sales
- Total cost
- Total profit
- Units sold
- Average sale value
- Top-selling products
- Low-stock products

Do not overcomplicate reporting.

---

# 25. User Authentication

Approximately 2–3 internal users will use the application.

Users should have:

- id
- name
- email
- passwordHash
- role
- active
- createdAt

Roles:

```text
ADMIN
USER
```

ADMIN can:

- Manage users
- Manage products
- Adjust inventory
- View sales
- Cancel/return sales
- Export data

USER can:

- Scan
- View products
- Sell products
- View appropriate sales information

Do not store plaintext passwords.

Use secure password hashing.

Use secure sessions.

---

# 26. Audit Trail

Important operations should record who performed them.

Examples:

```text
PRODUCT_CREATED
PRODUCT_UPDATED
INVENTORY_ADJUSTED
SALE_COMPLETED
SALE_CANCELLED
SALE_RETURNED
USER_CREATED
```

Audit fields:

- id
- userId
- action
- entityType
- entityId
- metadata
- createdAt

---

# 27. Image Storage

Do not store large image binaries directly in PostgreSQL.

Abstract image storage behind a simple service/interface.

For V1, use a simple cloud-compatible image storage mechanism.

Make it easy to replace later.

Database should store:

```text
imageUrl
```

not the binary itself.

If Railway/local filesystem is used during development, production must not depend on ephemeral local storage.

---

# 28. CSV Import

Create:

```text
/products/import
```

Allow CSV upload.

Example:

```csv
sku,name,category,description,original_price,cost_price,quantity,supplier
```

Validate every row.

Show preview before importing.

Example:

```text
Import Preview

25 valid rows
2 invalid rows

Row 17:
Duplicate SKU: SHOE-1001

Row 21:
Invalid cost price

[Import Valid Rows]
```

Do not partially import silently.

---

# 29. CSV Export

Allow exporting:

- Products
- Sales
- Inventory transactions
- Reports

Export CSV.

---

# 30. Search

Global product search should support:

- SKU
- Product name
- Category

SKU should be the most important search field.

Make search mobile-friendly.

---

# 31. Mobile UX

Design mobile-first.

Recommended mobile navigation:

```text
Home
Scan
Sell
Products
Sales
More
```

The Scan button should be prominent.

Sell workflow should require as few taps as possible.

Ideal:

```text
Open Sell
 ↓
Scan
 ↓
Enter price
 ↓
Enter quantity
 ↓
Complete Sale
```

---

# 32. Camera Permissions

Handle browser camera permission gracefully.

If denied:

```text
Camera access is required to scan QR codes.
Please enable camera access in your browser settings.
```

Also provide:

```text
[Enter SKU Manually]
```

as a fallback.

---

# 33. QR Scanner

Use a well-maintained browser-compatible QR scanning library.

Do not reinvent QR decoding.

The scanner should support normal phone cameras.

Test:

- Android Chrome
- iPhone Safari
- Desktop where possible

---

# 34. Security

Implement:

- Password hashing
- Secure sessions
- Authentication middleware
- Authorization
- Input validation
- SQL injection protection
- XSS protection
- CSRF protection where applicable
- Rate limiting for login
- Secure cookies
- Server-side validation
- Never trust client-side calculations
- Never expose cost/profit through public QR pages
- Validate uploaded files
- Limit image file size
- Validate image MIME types

---

# 35. Database Schema

Expected tables may include:

```text
users
products
inventory_transactions
sales
sale_items
categories
audit_logs
```

Use foreign keys.

Use indexes for:

- products.sku
- products.name
- sales.sale_number
- sales.sold_at
- sale_items.product_id
- inventory_transactions.product_id
- products.public_identifier

Use appropriate unique constraints.

---

# 36. Concurrency

Even though there are only 2–3 users, sale processing must be safe.

Example:

```text
Inventory = 1

User A sells 1
User B simultaneously sells 1
```

Only one transaction should succeed.

Use PostgreSQL transaction/locking mechanisms where appropriate.

Never allow inventory to become -1.

---

# 37. Error Handling

Create friendly error states.

Examples:

- Product not found
- SKU already exists
- Insufficient inventory
- Invalid price
- Invalid quantity
- Camera unavailable
- Unauthorized
- Session expired
- Product image upload failed
- Database error

Do not show raw stack traces to users.

Log technical errors server-side.

---

# 38. Design

Use a clean modern UI.

Style:

- Minimal
- Professional
- Mobile-first
- Fast
- Readable
- Good spacing
- Large touch targets
- Clear buttons

Do not make it look like a generic admin template.

Prioritize usability over visual decoration.

---

# 39. Product Creation

Create:

```text
/products/new
```

Form:

- Product Name
- SKU
- Category
- Description
- Photo
- Original Price
- Cost Price
- Selling Price (optional)
- Initial Quantity
- Supplier
- Location
- Notes

After creation:

Generate QR code.

Show:

```text
Product created successfully.

[View Product]

[Download QR]

[Print QR]
```

---

# 40. Inventory Adjustment

Provide adjustment UI.

Example:

```text
Current quantity: 10

Adjustment: +5

Reason: New stock
```

or:

```text
Adjustment: -2

Reason: Damaged
```

Require a reason for manual adjustments.

Create an inventory transaction.

---

# 41. Authentication-Aware Product Page Acceptance Test

Create:

```text
Product:
Nike Shoes

SKU:
SHOE-001

Photo:
nike.jpg

Original Price:
₹5,999

Cost:
₹2,500

Selling Price:
₹4,999

Quantity:
5
```

Generate QR.

## Test A — Public

Open QR URL in an incognito browser.

Expected:

```text
Photo: YES
Name: YES
Price: ₹4,999

Cost: NO
SKU: NO
Quantity: NO
Supplier: NO
Profit: NO
Sales: NO
```

## Test B — Authenticated

Log in.

Open the same QR URL.

Expected:

```text
Photo: YES
Name: YES
SKU: SHOE-001
Quantity: 5
Original Price: ₹5,999
Cost: ₹2,500
Selling Price: ₹4,999
Supplier: YES
Description: YES
Inventory/actions: YES according to role
```

## Test C — Selling Price Missing

Set:

```text
sellingPrice = NULL
```

Open QR while logged out.

Expected:

```text
Photo: YES
Name: YES
Price: "Price unavailable"

Cost: NO
Original Price: NO
```

---

# 42. Sale Test Case

Create:

```text
Product:
TEST-001

Cost:
₹100

Quantity:
5
```

Sell:

```text
Quantity = 2
Sold price = ₹150
```

Expected:

```text
Revenue = ₹300
Cost = ₹200
Profit = ₹100
Remaining quantity = 3
```

Inventory transaction:

```text
SALE -2
```

Sale status:

```text
COMPLETED
```

---

# 43. API Design

If using REST endpoints, create clean APIs such as:

```text
POST /api/products
GET /api/products
GET /api/products/:id
PUT /api/products/:id
DELETE /api/products/:id

GET /api/public/products/:identifier

POST /api/products/:id/qr

POST /api/inventory/adjust
GET /api/inventory/:productId

POST /api/sales
GET /api/sales
GET /api/sales/:id

POST /api/sales/:id/cancel
POST /api/sales/:id/return

POST /api/import/products

GET /api/export/products

GET /api/reports/sales
```

Adapt this to the chosen Next.js architecture if server actions are more appropriate.

---

# 44. Validation

Use a schema validation library such as Zod.

Validate:

- SKU
- Prices
- Quantity
- Product fields
- CSV imports
- API requests

Never depend solely on frontend validation.

---

# 45. Currency

Make currency configurable.

Default:

```text
INR ₹
```

Store monetary values safely.

Prefer PostgreSQL numeric/decimal rather than floating point for financial values.

Do not use JavaScript floating point calculations for persisted money values where precision matters.

---

# 46. Timezone

Make timezone configurable.

Default:

```text
Asia/Kolkata
```

Store timestamps consistently.

Display timestamps in the configured business timezone.

---

# 47. Seed Data

Create development seed data:

- 10 products
- Different categories
- Different quantities
- Different costs
- Several completed sales
- Some low-stock products
- At least one admin user
- At least one regular user

Document development login credentials clearly in README.

Do not use weak credentials in production.

---

# 48. Testing

Write automated tests for:

- Product creation
- Duplicate SKU
- Inventory addition
- Inventory adjustment
- Sale creation
- Inventory reduction
- Insufficient inventory
- Profit calculation
- Sale cancellation
- Sale return
- Concurrent inventory updates
- Public product access
- Authentication
- Authorization
- CSV import validation

---

# 49. Railway Deployment

Application must be deployable to Railway.

Provide:

- Dockerfile if appropriate
- Railway configuration
- Database migration process
- Environment variable configuration
- Production startup command
- README deployment instructions

Expected environment variables:

```text
DATABASE_URL
AUTH_SECRET
APP_URL
IMAGE_STORAGE configuration
```

Add any other required secrets.

Never commit secrets.

Provide:

```text
.env.example
```

---

# 50. Database Migrations

Support:

- Development database
- Production database
- Migration command
- Seed command

Document:

- How to create migration
- How to run migration
- How to seed database
- How to reset development database

Do NOT make destructive database resets part of production commands.

---

# 51. Logging

Implement useful server-side logging.

Log:

- Authentication failures
- Product creation/update
- Inventory adjustments
- Sales
- Sale cancellation/returns
- Unexpected errors

Do not log:

- Passwords
- Authentication secrets
- Sensitive credentials

---

# 52. Performance

This application will initially be small.

Do not prematurely optimize.

However:

- Use database indexes
- Paginate product lists
- Paginate sales
- Optimize product images
- Avoid unnecessary API calls
- Do not load every sale/product into the browser at once

---

# 53. Accessibility

Use:

- Readable font sizes
- Good contrast
- Proper form labels
- Keyboard navigation where applicable
- Large mobile touch targets
- Accessible buttons
- Loading states
- Error states

---

# 54. Loading States

Every asynchronous action should have appropriate loading feedback.

Examples:

```text
Scanning...
Creating product...
Uploading image...
Completing sale...
Importing products...
Generating QR...
```

Do not allow users to accidentally submit the same sale twice.

Disable submit while processing.

---

# 55. Duplicate Sale Protection

Protect against double submission.

Example:

User taps:

```text
Complete Sale
```

twice quickly.

Do NOT create two sales.

Use appropriate client/server protection.

---

# 56. Application Routes

Recommended:

```text
/
/login

/dashboard

/products
/products/new
/products/[id]
/products/[id]/edit
/products/import

/sell
/scan

/sales
/sales/[id]

/reports

/settings

/p/[publicIdentifier]
```

Adjust routes if needed.

---

# 57. Navigation

Authenticated desktop:

```text
Dashboard
Products
Inventory
Scan
Sell
Sales
Reports
Users
Settings
```

Mobile:

```text
Home
Scan
Sell
Products
Sales
More
```

Keep Scan and Sell very easy to reach.

---

# 58. Most Important UX Principle

The most common operation is expected to be:

> "I have an item in my hand and want to sell it."

Therefore this workflow should take only a few actions:

```text
1. Open Sell
2. Scan QR
3. Enter quantity
4. Enter sold price
5. Complete Sale
```

Optimize this workflow above everything else.

---

# 59. Future Extensibility

Design cleanly so we can eventually add:

- Multiple stores/locations
- Suppliers
- Purchase orders
- Customer records
- WhatsApp integration
- Invoice generation
- Payment tracking
- Barcode support
- Product variants
- Multiple currencies
- GST/tax
- Advanced reports
- Expenses
- Profit margins
- Low-stock notifications

Do NOT implement these now unless required by the core application.

Build V1 cleanly so they can be added later.

---

# 60. Development Process

Do NOT simply generate a huge code dump.

Work incrementally.

First:

1. Analyze requirements.
2. Inspect the repository.
3. Propose final architecture.
4. Propose database ERD.
5. Propose folder structure.
6. Identify ambiguities.
7. Then begin implementation.

After architecture is established, implement in phases.

---

# 61. Implementation Phases

## Phase 1 — Project Foundation

Implement:

- Next.js
- TypeScript
- Tailwind
- UI framework
- PostgreSQL
- ORM
- Migrations
- Environment configuration
- Authentication foundation
- Basic layout

Verify the application runs.

---

## Phase 2 — Product Management

Implement:

- Product database
- Product CRUD
- SKU validation
- Product search
- Product photo
- Categories
- Inventory quantity
- Product details page

Write tests.

---

## Phase 3 — QR System

Implement:

- QR generation
- Public product identifier
- Public product page
- Authentication-aware product page
- QR download
- QR display
- Print functionality

Test scanning with mobile devices.

---

## Phase 4 — Inventory

Implement:

- Inventory transactions
- Add stock
- Adjustment
- Stock history
- Low stock detection

Write transaction tests.

---

## Phase 5 — Scan

Implement:

- Mobile camera QR scanner
- Scan result handling
- Product lookup
- Manual SKU fallback

Test camera permissions.

---

## Phase 6 — Sales

Implement:

- Sell page
- Scan product
- Quantity
- Sold price
- Sale calculation
- Profit calculation
- Inventory update
- Sale transaction
- Sale history
- Sale confirmation

This phase must use proper database transactions.

---

## Phase 7 — Returns/Cancellations

Implement:

- Cancel sale
- Return sale
- Restore inventory
- Inventory transaction
- Audit log

---

## Phase 8 — Dashboard/Reports

Implement:

- Dashboard
- Sales summary
- Revenue
- Cost
- Profit
- Units sold
- Recent sales
- Low stock
- Date filters
- Reports

---

## Phase 9 — CSV

Implement:

- CSV import
- Validation
- Preview
- Import
- CSV export

---

## Phase 10 — Security and Polish

Review:

- Authentication
- Authorization
- Validation
- Rate limiting
- File uploads
- Public page security
- Error handling
- Loading states
- Mobile UI
- Accessibility
- Audit logging

---

## Phase 11 — Testing

Run:

- Unit tests
- Integration tests
- Database tests
- API tests
- Critical UI tests

Fix all important issues.

---

## Phase 12 — Railway Deployment

Prepare:

- Dockerfile
- Railway configuration
- PostgreSQL
- Environment variables
- Production build
- Migration process
- Seed process

Document deployment.

---

# 62. Definition of Done

The following complete workflow must work.

## Product Creation

User logs in.

Creates:

```text
Product:
Nike Shoes

SKU:
SHOE-001

Original price:
₹5,000

Cost:
₹2,500

Quantity:
5
```

Uploads photo.

Clicks Create.

System:

- Creates product
- Generates public identifier
- Generates QR code

---

## Public QR Scan

Someone scans the QR code without being logged in.

Product page shows only:

```text
Photo
Product Name
Current Selling Price
```

No internal information is exposed.

---

## Authenticated QR Scan

Staff logs in and scans the same QR.

The full product page appears:

```text
Photo
Name
SKU
Quantity
Original Price
Cost Price
Selling Price
Category
Supplier
Location
Description
Notes
Inventory history
Actions
```

---

## Sell

Staff:

```text
Open Sell
 ↓
Scan QR
 ↓
Product recognized
 ↓
Quantity = 2
 ↓
Sold price = ₹4,000
 ↓
Complete Sale
```

System:

- Creates sale
- Creates sale item
- Reduces inventory 5 → 3
- Creates inventory transaction
- Calculates revenue
- Calculates cost
- Calculates profit
- Creates audit entry

---

## Sales

Sales page shows:

```text
Sale Number
Product
Quantity
Sold Price
Revenue
Cost
Profit
Date
User
Status
```

---

## Dashboard

Dashboard updates automatically:

```text
Inventory: 3

Revenue: ₹8,000

Profit: ₹3,000
```

---

## Return

If sale is returned:

```text
Inventory:
3 → 5

Sale:
RETURNED

Inventory transaction:
+2
```

Historical sale remains in the database.

---

# 63. Engineering Rules

Follow these rules throughout development:

1. Keep the application simple.
2. Do not introduce microservices.
3. Do not introduce unnecessary infrastructure.
4. Keep business logic server-side.
5. Use database transactions for inventory/sales.
6. Never allow negative inventory.
7. Never delete historical sales.
8. Store historical cost/sold prices in sale items.
9. Never expose internal financial information through public QR pages.
10. Validate everything server-side.
11. Use migrations.
12. Never commit secrets.
13. Do not store passwords in plaintext.
14. Make the application mobile-first.
15. Optimize the scan → sell workflow.
16. Prevent duplicate sale submissions.
17. Record important inventory changes.
18. Make the code readable and maintainable.
19. Add tests around financial and inventory logic.
20. Document important architectural decisions.

---

# 64. Claude Code Behavior

You are working as an autonomous senior engineer.

When implementing:

- Inspect the repository first.
- Do not overwrite existing work unnecessarily.
- Reuse existing components where appropriate.
- Explain significant architectural decisions.
- Implement one phase at a time.
- Run tests after each major phase.
- Run linting/type checks.
- Fix errors before moving forward.
- Do not leave TODO placeholders for core functionality.
- Do not create fake/mock implementations for required production functionality.
- Do not claim something works without testing it.
- If an external service requires credentials, create the integration properly and document required environment variables.
- Keep commits logically organized if git is available.

When you finish each phase, report:

1. What was implemented
2. Files changed
3. Database changes
4. Tests added
5. Tests executed
6. Remaining issues
7. How to manually verify the feature

---

# 65. First Task

Before writing application code, inspect the repository and determine whether this is:

- an empty repository
- an existing project
- an existing Next.js project
- another application

Then provide:

1. Recommended architecture
2. Technology choices
3. Database ERD
4. Folder structure
5. Authentication approach
6. QR architecture
7. Image storage approach
8. Deployment architecture
9. Implementation phases

Then begin implementing Phase 1.

Do not wait unnecessarily for confirmation if the requirements are sufficiently clear.

The final goal is a working application that can actually be deployed to Railway and used from mobile phones by 2–3 internal users.

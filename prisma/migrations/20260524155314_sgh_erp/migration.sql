-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EMPLOYEE', 'MANAGER', 'SHOWROOM_STAFF');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('LOCATION', 'SHOWROOM', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "MaterialType" AS ENUM ('WOOD', 'IRON', 'WOOD_IRON', 'IRON_MARBLE', 'WOOD_MARBLE', 'OTHER');

-- CreateEnum
CREATE TYPE "PieceStage" AS ENUM ('AVAILABLE', 'IN_SHOWROOM', 'RESERVED', 'SOLD', 'DISPATCHED', 'IN_TRANSIT', 'RETURNED');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('RECEIPT', 'TRANSFER', 'SALE', 'RESERVATION', 'RETURN', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED_TO_SALE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'DISPATCHED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('SAMPLE_ORDER', 'REGULAR_ORDER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'FINALIZED', 'PENDING', 'IN_PRODUCTION', 'QC', 'POLISH', 'PACKAGING', 'READY_TO_SHIP', 'SHIPPED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "designation" TEXT,
    "department" TEXT,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "permissionsVersion" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatar" TEXT,
    "lastLogin" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockUntil" TIMESTAMP(3),
    "refreshTokenHash" TEXT,
    "assignedLocationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "fileNumber" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactPersonName" TEXT NOT NULL,
    "designation" TEXT,
    "agent" TEXT,
    "photo" TEXT,
    "country" TEXT NOT NULL,
    "priceType" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "portOfLoading" TEXT,
    "portOfDischarge" TEXT,
    "countryOfDestination" TEXT,
    "paymentTerms" TEXT,
    "shippingTerms" TEXT,
    "taxId" TEXT,
    "notes" TEXT,
    "customerSince" TIMESTAMP(3),
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "emails" JSONB NOT NULL DEFAULT '[]',
    "phones" JSONB NOT NULL DEFAULT '[]',
    "shippingAddresses" JSONB NOT NULL DEFAULT '[]',
    "billingAddresses" JSONB NOT NULL DEFAULT '[]',
    "advancePayments" JSONB NOT NULL DEFAULT '[]',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "fileNumber" TEXT NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "orderStatus" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDeliveryDate" TIMESTAMP(3),
    "proformaInvoiceNumber" TEXT,
    "buyerPONumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "containerSize" TEXT,
    "containerNumber" TEXT,
    "totalCBM" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "totalWeight" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "finalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advanceReceived" BOOLEAN NOT NULL DEFAULT false,
    "advanceAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advanceReceivedAt" TIMESTAMP(3),
    "orderImages" JSONB NOT NULL DEFAULT '[]',
    "specialInstructions" TEXT,
    "internalNotes" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "comments" JSONB NOT NULL DEFAULT '[]',
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" INTEGER,
    "draftProgress" INTEGER NOT NULL DEFAULT 0,
    "createdById" INTEGER,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "companySKU" TEXT NOT NULL,
    "buyerSKU" TEXT,
    "buyerDescription" TEXT,
    "itemDescription" TEXT,
    "itemCategory" TEXT,
    "collectionName" TEXT,
    "materials" JSONB NOT NULL DEFAULT '[]',
    "finishes" JSONB NOT NULL DEFAULT '[]',
    "itemCondition" TEXT,
    "hsnCode" TEXT,
    "barcodeText" TEXT,
    "barcodeImage" TEXT,
    "dimensions" JSONB,
    "cbm" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "totalCBM" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "weight" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "images" JSONB NOT NULL DEFAULT '[]',
    "primaryImage" TEXT,
    "comments" JSONB NOT NULL DEFAULT '[]',
    "productionNotes" TEXT,
    "qcNotes" TEXT,
    "polishNotes" TEXT,
    "packagingNotes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerCatalogueFolder" (
    "id" SERIAL NOT NULL,
    "buyerId" INTEGER NOT NULL,
    "fileNumber" TEXT NOT NULL,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerCatalogueFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerCatalogueProduct" (
    "id" SERIAL NOT NULL,
    "folderId" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "buyerSKU" TEXT,
    "buyerDescription" TEXT,
    "itemDescription" TEXT,
    "itemCategory" TEXT,
    "collectionName" TEXT,
    "materials" JSONB NOT NULL DEFAULT '[]',
    "finishes" JSONB NOT NULL DEFAULT '[]',
    "itemCondition" TEXT,
    "hsnCode" TEXT,
    "barcodeText" TEXT,
    "barcodeImage" TEXT,
    "dimensions" JSONB,
    "cbm" DECIMAL(10,3) NOT NULL DEFAULT 0,
    "weight" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "images" JSONB NOT NULL DEFAULT '[]',
    "primaryImage" TEXT,
    "productionNotes" TEXT,
    "qcNotes" TEXT,
    "polishNotes" TEXT,
    "packagingNotes" TEXT,
    "firstOrderedAt" TIMESTAMP(3),
    "lastOrderedAt" TIMESTAMP(3),
    "totalTimesOrdered" INTEGER NOT NULL DEFAULT 0,
    "totalQuantityOrdered" INTEGER NOT NULL DEFAULT 0,
    "currentPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "priceHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerCatalogueProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL,
    "parentId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "materialType" "MaterialType" NOT NULL,
    "defaultUnit" TEXT NOT NULL DEFAULT 'piece',
    "description" TEXT,
    "basePrice" DECIMAL(12,2),
    "baseImages" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductInstance" (
    "id" SERIAL NOT NULL,
    "instanceCode" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "currentLocationId" INTEGER,
    "currentStage" "PieceStage" NOT NULL DEFAULT 'IN_SHOWROOM',
    "arrivalDate" TIMESTAMP(3),
    "listedPrice" DECIMAL(12,2),
    "actualDimensions" JSONB,
    "photos" JSONB,
    "qualityNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLedger" (
    "id" BIGSERIAL NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "voucherType" "VoucherType" NOT NULL,
    "instanceId" INTEGER,
    "productId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" SERIAL NOT NULL,
    "reservationNo" TEXT NOT NULL,
    "instanceId" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerEmail" TEXT,
    "reservedById" INTEGER NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "holdUntil" TIMESTAMP(3),
    "advancePaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowroomSale" (
    "id" SERIAL NOT NULL,
    "saleNo" TEXT NOT NULL,
    "instanceId" INTEGER NOT NULL,
    "showroomId" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerAddress" TEXT,
    "salePrice" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentMode" "PaymentMode",
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "saleDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchStatus" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "soldById" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowroomSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowroomProduct" (
    "id" SERIAL NOT NULL,
    "branch" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "companySKU" TEXT NOT NULL,
    "size" TEXT,
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "photos" JSONB NOT NULL DEFAULT '[]',
    "primaryImage" TEXT,
    "description" TEXT,
    "createdById" INTEGER,
    "modifiedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowroomProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherSequence" (
    "id" SERIAL NOT NULL,
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VoucherSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_userId_key" ON "User"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_fileNumber_key" ON "Customer"("fileNumber");

-- CreateIndex
CREATE INDEX "Customer_country_status_idx" ON "Customer"("country", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Order_proformaInvoiceNumber_key" ON "Order"("proformaInvoiceNumber");

-- CreateIndex
CREATE INDEX "Order_fileNumber_orderStatus_idx" ON "Order"("fileNumber", "orderStatus");

-- CreateIndex
CREATE INDEX "Order_orderDate_idx" ON "Order"("orderDate");

-- CreateIndex
CREATE INDEX "OrderItem_companySKU_idx" ON "OrderItem"("companySKU");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerCatalogueFolder_buyerId_fileNumber_key" ON "BuyerCatalogueFolder"("buyerId", "fileNumber");

-- CreateIndex
CREATE INDEX "BuyerCatalogueProduct_folderId_sku_idx" ON "BuyerCatalogueProduct"("folderId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductInstance_instanceCode_key" ON "ProductInstance"("instanceCode");

-- CreateIndex
CREATE INDEX "ProductInstance_currentLocationId_currentStage_idx" ON "ProductInstance"("currentLocationId", "currentStage");

-- CreateIndex
CREATE INDEX "StockLedger_instanceId_locationId_idx" ON "StockLedger"("instanceId", "locationId");

-- CreateIndex
CREATE INDEX "StockLedger_voucherNo_idx" ON "StockLedger"("voucherNo");

-- CreateIndex
CREATE INDEX "StockLedger_postingDate_idx" ON "StockLedger"("postingDate");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_reservationNo_key" ON "Reservation"("reservationNo");

-- CreateIndex
CREATE UNIQUE INDEX "ShowroomSale_saleNo_key" ON "ShowroomSale"("saleNo");

-- CreateIndex
CREATE INDEX "ShowroomSale_saleDate_idx" ON "ShowroomSale"("saleDate");

-- CreateIndex
CREATE INDEX "ShowroomSale_showroomId_saleDate_idx" ON "ShowroomSale"("showroomId", "saleDate");

-- CreateIndex
CREATE INDEX "ShowroomProduct_branch_section_idx" ON "ShowroomProduct"("branch", "section");

-- CreateIndex
CREATE INDEX "ShowroomProduct_companySKU_idx" ON "ShowroomProduct"("companySKU");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherSequence_prefix_year_key" ON "VoucherSequence"("prefix", "year");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_assignedLocationId_fkey" FOREIGN KEY ("assignedLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerCatalogueProduct" ADD CONSTRAINT "BuyerCatalogueProduct_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "BuyerCatalogueFolder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductInstance" ADD CONSTRAINT "ProductInstance_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductInstance" ADD CONSTRAINT "ProductInstance_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ProductInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLedger" ADD CONSTRAINT "StockLedger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ProductInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_reservedById_fkey" FOREIGN KEY ("reservedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowroomSale" ADD CONSTRAINT "ShowroomSale_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ProductInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowroomSale" ADD CONSTRAINT "ShowroomSale_showroomId_fkey" FOREIGN KEY ("showroomId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowroomSale" ADD CONSTRAINT "ShowroomSale_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

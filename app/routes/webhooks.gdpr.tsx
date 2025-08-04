// 1. Create: app/routes/webhooks.gdpr.tsx - Single GDPR endpoint
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // ✅ CRITICAL: This will return HTTP 401 automatically if HMAC is invalid
    const { shop, payload, topic } = await authenticate.webhook(request);
    
    console.log(`🔒 GDPR webhook received: ${topic} for shop: ${shop}`);
    
    // Handle different GDPR webhook types based on the topic
    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST":
        await handleCustomerDataRequest(shop, payload);
        break;
      case "CUSTOMERS_REDACT":
        await handleCustomerRedact(shop, payload);
        break;
      case "SHOP_REDACT":
        await handleShopRedact(shop, payload);
        break;
      default:
        console.log(`⚠️ Unknown GDPR webhook topic: ${topic}`);
    }
    
    // ✅ IMPORTANT: Return HTTP 200 for successful processing
    return new Response(null, { status: 200 });
    
  } catch (error: any) {
    console.error("❌ GDPR webhook error:", error);
    
    // ✅ CRITICAL: If authenticate.webhook fails, it throws an error
    // This should result in HTTP 401, but let's make sure
    if (error.message?.includes("HMAC") || error.message?.includes("unauthorized")) {
      return new Response("Unauthorized - Invalid HMAC", { status: 401 });
    }
    
    // For other errors, return 500
    return new Response("Internal Server Error", { status: 500 });
  }
};

// Helper function for customer data requests
async function handleCustomerDataRequest(shop: string, payload: any) {
  console.log(`📧 Processing customer data request for shop: ${shop}`);
  
  const customerId = payload.customer?.id;
  const customerEmail = payload.customer?.email;
  
  if (!customerId && !customerEmail) {
    console.log("⚠️ No customer ID or email provided in data request");
    return;
  }
  
  try {
    // Get all data for this customer
    const customerData = await db.pricingHistory.findMany({
      where: {
        shop,
        ...(customerEmail && { userEmail: customerEmail })
      }
    });
    
    // Format data for GDPR compliance
    const gdprData = {
      customer_id: customerId,
      email: customerEmail,
      shop: shop,
      data_type: "pricing_history",
      records: customerData.map(record => ({
        id: record.id,
        date: record.createdAt.toISOString(),
        product_title: record.productTitle,
        variant_title: record.variantTitle,
        action_type: record.actionType,
        old_price: record.oldPrice,
        new_price: record.newPrice,
        adjustment_value: record.adjustmentValue
      }))
    };
    
    console.log(`📊 Prepared GDPR data export: ${customerData.length} records for ${customerEmail}`);
    
    // In production, you would:
    // 1. Generate a secure download link
    // 2. Email the customer with the link
    // 3. Set the link to expire after 72 hours
    
    // For now, log successful processing
    console.log(`✅ Customer data request processed for ${customerEmail || customerId}`);
    
  } catch (error) {
    console.error("❌ Error processing customer data request:", error);
    throw error;
  }
}

// Helper function for customer data redaction
async function handleCustomerRedact(shop: string, payload: any) {
  console.log(`🗑️ Processing customer redact request for shop: ${shop}`);
  
  const customerId = payload.customer?.id;
  const customerEmail = payload.customer?.email;
  
  if (!customerId && !customerEmail) {
    console.log("⚠️ No customer ID or email provided in redact request");
    return;
  }
  
  try {
    // Delete all data associated with this customer
    const deleteResult = await db.pricingHistory.deleteMany({
      where: {
        shop,
        ...(customerEmail && { userEmail: customerEmail })
      }
    });
    
    console.log(`🗑️ Deleted ${deleteResult.count} pricing history records for customer ${customerEmail || customerId}`);
    console.log(`✅ Customer data redaction completed for shop: ${shop}`);
    
  } catch (error) {
    console.error("❌ Error processing customer redact:", error);
    throw error;
  }
}

// Helper function for shop data redaction  
async function handleShopRedact(shop: string, payload: any) {
  console.log(`🏪 Processing shop redact request for shop: ${shop}`);
  
  try {
    // Delete ALL data for this shop (occurs 48 hours after app uninstall)
    const deleteOperations = await Promise.all([
      db.pricingHistory.deleteMany({ where: { shop } }),
      db.subscription.deleteMany({ where: { shop } }),
      // Add any other tables that store shop data
    ]);
    
    const totalDeleted = deleteOperations.reduce((sum, result) => sum + result.count, 0);
    
    console.log(`🗑️ Shop redaction completed: Deleted ${totalDeleted} total records for shop ${shop}`);
    console.log(`✅ All shop data permanently removed for ${shop}`);
    
  } catch (error) {
    console.error("❌ Error processing shop redact:", error);
    throw error;
  }
}
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("🔄 GDPR webhook received");
  
  try {
    // ✅ CRITICAL FIX: Use authenticate.webhook which handles HMAC validation
    // This will throw an error (likely 401) if HMAC is invalid
    const { shop, payload, topic } = await authenticate.webhook(request);
    
    console.log(`✅ HMAC validated - Topic: ${topic}, Shop: ${shop}`);
    
    // Handle different GDPR webhook types
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
        console.log(`⚠️ Unknown GDPR topic: ${topic}`);
    }
    
    console.log("✅ GDPR webhook processed successfully");
    return new Response(null, { status: 200 });
    
  } catch (error: any) {
    console.error("❌ GDPR webhook error:", error.message);
    
    // ✅ CRITICAL: Check if this is an authentication/HMAC error
    // Shopify's authenticate.webhook throws specific errors for invalid HMAC
    if (
      error.message?.toLowerCase().includes('unauthorized') ||
      error.message?.toLowerCase().includes('hmac') ||
      error.message?.toLowerCase().includes('invalid') ||
      error.status === 401 ||
      error.name === 'Unauthorized'
    ) {
      console.log("🚨 HMAC validation failed - returning 401");
      return new Response("Unauthorized", { status: 401 });
    }
    
    // For any other errors, still return 500 but with proper error handling
    console.error("💥 Server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
};

async function handleCustomerDataRequest(shop: string, payload: any) {
  try {
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;
    
    console.log(`📊 Customer data request for shop: ${shop}`);
    
    if (!customerId && !customerEmail) {
      console.log("⚠️ No customer identifier provided");
      return;
    }
    
    // Get customer data from database
    const customerData = await db.pricingHistory.findMany({
      where: {
        shop,
        ...(customerEmail && { userEmail: customerEmail })
      }
    });
    
    console.log(`📈 Found ${customerData.length} records for customer`);
    
    // In production: generate secure download link and email customer
    // For now, just log that we processed it
    console.log("✅ Customer data request processed");
    
  } catch (error) {
    console.error("❌ Error in handleCustomerDataRequest:", error);
    throw error;
  }
}

async function handleCustomerRedact(shop: string, payload: any) {
  try {
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;
    
    console.log(`🗑️ Customer redact request for shop: ${shop}`);
    
    if (!customerId && !customerEmail) {
      console.log("⚠️ No customer identifier provided");
      return;
    }
    
    // Delete customer data
    const deleteResult = await db.pricingHistory.deleteMany({
      where: {
        shop,
        ...(customerEmail && { userEmail: customerEmail })
      }
    });
    
    console.log(`🗑️ Deleted ${deleteResult.count} records for customer`);
    console.log("✅ Customer redact completed");
    
  } catch (error) {
    console.error("❌ Error in handleCustomerRedact:", error);
    throw error;
  }
}

async function handleShopRedact(shop: string, payload: any) {
  try {
    console.log(`🏪 Shop redact request for shop: ${shop}`);
    
    // Delete all shop data
    const deleteOperations = await Promise.all([
      db.pricingHistory.deleteMany({ where: { shop } }),
      db.subscription.deleteMany({ where: { shop } }),
    ]);
    
    const totalDeleted = deleteOperations.reduce((sum, result) => sum + result.count, 0);
    
    console.log(`🗑️ Deleted ${totalDeleted} total records for shop ${shop}`);
    console.log("✅ Shop redact completed");
    
  } catch (error) {
    console.error("❌ Error in handleShopRedact:", error);
    throw error;
  }
}
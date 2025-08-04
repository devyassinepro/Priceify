// 1. Create: app/routes/webhooks.gdpr.tsx - Debug version with detailed logging
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("🔄 GDPR webhook received - starting processing...");
  
  // Log request details for debugging
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers.entries());
  
  console.log("📨 Request details:");
  console.log("- URL:", url.toString());
  console.log("- Method:", request.method);
  console.log("- Headers:", JSON.stringify(headers, null, 2));
  
  try {
    // ✅ This should automatically handle HMAC validation and return 401 if invalid
    console.log("🔐 Attempting HMAC validation...");
    const { shop, payload, topic } = await authenticate.webhook(request);
    
    console.log("✅ HMAC validation successful!");
    console.log("- Shop:", shop);
    console.log("- Topic:", topic);
    console.log("- Payload:", JSON.stringify(payload, null, 2));
    
    // Handle different GDPR webhook types
    switch (topic) {
      case "CUSTOMERS_DATA_REQUEST":
        console.log("📧 Processing customer data request...");
        await handleCustomerDataRequest(shop, payload);
        break;
        
      case "CUSTOMERS_REDACT":
        console.log("🗑️ Processing customer redact request...");
        await handleCustomerRedact(shop, payload);
        break;
        
      case "SHOP_REDACT":
        console.log("🏪 Processing shop redact request...");
        await handleShopRedact(shop, payload);
        break;
        
      default:
        console.log(`⚠️ Unknown GDPR webhook topic: ${topic}`);
    }
    
    console.log("✅ GDPR webhook processing completed successfully");
    return new Response(null, { 
      status: 200,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
  } catch (error: any) {
    console.error("❌ GDPR webhook error details:");
    console.error("- Error message:", error.message);
    console.error("- Error stack:", error.stack);
    console.error("- Error name:", error.name);
    
    // Check if this is an HMAC validation error
    if (error.message?.toLowerCase().includes('hmac') || 
        error.message?.toLowerCase().includes('unauthorized') ||
        error.message?.toLowerCase().includes('invalid') ||
        error.name === 'Unauthorized') {
      
      console.log("🚨 HMAC validation failed - returning 401");
      return new Response(JSON.stringify({
        error: "Unauthorized",
        message: "Invalid HMAC signature"
      }), { 
        status: 401,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
    
    // For other errors, return 500
    console.log("💥 Server error - returning 500");
    return new Response(JSON.stringify({
      error: "Internal Server Error",
      message: error.message
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
};

async function handleCustomerDataRequest(shop: string, payload: any) {
  try {
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;
    
    console.log(`📊 Customer data request - ID: ${customerId}, Email: ${customerEmail}`);
    
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
    console.log("✅ Customer data request processed successfully");
    
  } catch (error) {
    console.error("❌ Error in handleCustomerDataRequest:", error);
    throw error;
  }
}

async function handleCustomerRedact(shop: string, payload: any) {
  try {
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;
    
    console.log(`🗑️ Customer redact request - ID: ${customerId}, Email: ${customerEmail}`);
    
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
    console.log("✅ Customer redact completed successfully");
    
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
    console.log("✅ Shop redact completed successfully");
    
  } catch (error) {
    console.error("❌ Error in handleShopRedact:", error);
    throw error;
  }
}
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { db } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("🔄 App uninstall webhook received");
  
  try {
    // ✅ Use authenticate.webhook for proper HMAC validation
    const { shop, session, topic } = await authenticate.webhook(request);
    
    console.log(`📱 App uninstalled for shop: ${shop}`);

    // Clean up session data immediately
    if (session) {
      await db.session.deleteMany({ where: { shop } });
      console.log(`🗑️ Deleted session data for ${shop}`);
    }
    
    // Note: Don't delete subscription/history data here
    // Shopify will send SHOP_REDACT webhook later for GDPR compliance
    
    console.log("✅ App uninstall webhook processed successfully");
    return new Response(null, { status: 200 });
    
  } catch (error: any) {
    console.error("❌ App uninstall webhook error:", error.message);
    
    // Check for HMAC validation errors
    if (
      error.message?.toLowerCase().includes('unauthorized') ||
      error.message?.toLowerCase().includes('hmac') ||
      error.status === 401
    ) {
      console.log("🚨 HMAC validation failed - returning 401");
      return new Response("Unauthorized", { status: 401 });
    }
    
    // For other errors, return 500
    return new Response("Internal Server Error", { status: 500 });
  }
};